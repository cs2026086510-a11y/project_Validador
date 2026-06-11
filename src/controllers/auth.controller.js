const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db.config');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_validator_123';

const generateToken = (userId, email, role) => {
  return jwt.sign({ id: userId, email, role }, JWT_SECRET, { expiresIn: '1d' });
};

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
    }

    const userExists = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'El usuario ya está registrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, role',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];
    const token = generateToken(user.id, user.email, user.role);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); 
    await db.query(
      'INSERT INTO active_sessions (user_id, jwt_token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP, last_activity = CURRENT_TIMESTAMP, is_online = true WHERE id = $1', [user.id]);

    const ipAddress = req.ip || req.connection.remoteAddress;
    await db.query(
      'INSERT INTO audit_logs (usuario, accion, detalles, ip) VALUES ($1, $2, $3, $4)',
      [user.email, 'REGISTER', 'Registro de usuario normal', ipAddress]
    );

    res.status(201).json({ token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error del servidor al registrar usuario' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
    }

    const result = await db.query('SELECT * FROM users WHERE email = $1 AND activo = true', [email]);
    const user = result.rows[0];
    
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP, last_activity = CURRENT_TIMESTAMP, is_online = true WHERE id = $1', [user.id]);

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await db.query(
      'INSERT INTO login_history (user_id, ip_address, user_agent, access_method) VALUES ($1, $2, $3, $4)',
      [user.id, ipAddress, userAgent, 'local']
    );

    const token = generateToken(user.id, user.email, user.role);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO active_sessions (user_id, jwt_token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    await db.query(
      'INSERT INTO audit_logs (usuario, accion, detalles, ip) VALUES ($1, $2, $3, $4)',
      [user.email, 'LOGIN', 'Inicio de sesión de usuario normal', ipAddress]
    );

    res.json({ token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión' });
  }
};

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
    }

    const result = await db.query('SELECT * FROM admins WHERE correo = $1 AND activo = true', [email]);
    const admin = result.rows[0];
    
    if (!admin || !admin.password_hash) {
      return res.status(400).json({ error: 'Credenciales de administrador inválidas' });
    }

    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Credenciales de administrador inválidas' });
    }

    await db.query('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [admin.id]);

    const ipAddress = req.ip || req.connection.remoteAddress;

    // Reconocimiento automático del SUPERADMIN inicial
    if (process.env.ADMIN_EMAIL && admin.correo === process.env.ADMIN_EMAIL) {
      admin.rol = 'superadmin';
    }

    const token = generateToken(admin.id, admin.correo, admin.rol);

    await db.query(
      'INSERT INTO audit_logs (usuario, accion, detalles, ip) VALUES ($1, $2, $3, $4)',
      [admin.correo, 'ADMIN_LOGIN', 'Inicio de sesión de administrador', ipAddress]
    );

    res.json({ token, user: { name: admin.nombre, email: admin.correo, role: admin.rol } });
  } catch (err) {
    console.error('Error en admin login:', err);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión' });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await db.query('DELETE FROM active_sessions WHERE jwt_token = $1', [token]);
    }
    if (req.user && req.user.id && req.user.role === 'user') {
      await db.query("UPDATE users SET is_online = false WHERE id = $1", [req.user.id]);
    }
    if (req.user) {
       const ipAddress = req.ip || req.connection.remoteAddress;
       await db.query(
         'INSERT INTO audit_logs (usuario, accion, detalles, ip) VALUES ($1, $2, $3, $4)',
         [req.user.email, 'LOGOUT', 'Cierre de sesión', ipAddress]
       );
    }
    res.json({ message: 'Sesión cerrada exitosamente' });
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
    res.status(500).json({ error: 'Error del servidor al cerrar sesión' });
  }
};

module.exports = {
  register,
  login,
  adminLogin,
  logout,
  JWT_SECRET
};
