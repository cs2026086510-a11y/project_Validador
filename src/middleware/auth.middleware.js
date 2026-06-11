const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_validator_123';

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ error: 'Token no provisto' });

  const token = authHeader.split(' ')[1]; // Formato "Bearer TOKEN"
  if (!token) return res.status(403).json({ error: 'Formato de token inválido' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'No autorizado o token expirado' });
    }
    req.user = decoded; // { id, email, role }
    next();
  });
};

const isAdmin = (req, res, next) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || (adminEmail && req.user.email === adminEmail))) {
    next();
  } else {
    res.status(403).json({ error: 'Requiere permisos de administrador' });
  }
};

const isSuperAdmin = (req, res, next) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (req.user && (req.user.role === 'superadmin' || (adminEmail && req.user.email === adminEmail))) {
    next();
  } else {
    res.status(403).json({ error: 'Requiere permisos de SUPERADMIN' });
  }
};

module.exports = {
  verifyToken,
  isAdmin,
  isSuperAdmin
};
