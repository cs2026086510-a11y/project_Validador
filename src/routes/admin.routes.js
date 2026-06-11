const express = require('express');
const router = express.Router();
const { isSuperAdmin } = require('../middleware/auth.middleware');
const { 
  getGeneralStats, 
  getActiveUsers, 
  getRecentLogins, 
  getLoginHistory, 
  searchUserByEmail,
  getTotalUsers,
  getAuditLogs,
  getAdmins,
  createAdmin,
  deactivateAdmin,
  reactivateAdmin,
  deleteAdmin,
  updateAdminRole,
  deleteUser,
  deactivateUser,
  reactivateUser
} = require('../controllers/admin.controller');

// Obtener estadísticas generales
router.get('/stats', getGeneralStats);

// Obtener total de usuarios registrados
router.get('/users', getTotalUsers);

// Obtener usuarios activos (actividad en últimos 10 min)
router.get('/active', getActiveUsers);

// Obtener últimos accesos (límite de 10)
router.get('/logins/recent', getRecentLogins);

// Obtener historial completo de inicios de sesión
router.get('/logins/history', getLoginHistory);

// Buscar usuario por correo (?email=...)
router.get('/users/search', searchUserByEmail);

// Obtener registros de auditoría
router.get('/audit', getAuditLogs);

// Obtener administradores
router.get('/admins', getAdmins);

// ============================================
// RUTAS SUPERADMIN
// ============================================

// Crear administrador
router.post('/admins', isSuperAdmin, createAdmin);

// Desactivar administrador
router.put('/admins/:id/deactivate', isSuperAdmin, deactivateAdmin);

// Reactivar administrador
router.put('/admins/:id/reactivate', isSuperAdmin, reactivateAdmin);

// Eliminar administrador
router.delete('/admins/:id', isSuperAdmin, deleteAdmin);

// Cambiar rol de administrador
router.put('/admins/:id/role', isSuperAdmin, updateAdminRole);

// Desactivar usuario normal
router.put('/users/:id/deactivate', isSuperAdmin, deactivateUser);

// Reactivar usuario normal
router.put('/users/:id/reactivate', isSuperAdmin, reactivateUser);

// Eliminar usuario normal
router.delete('/users/:id', isSuperAdmin, deleteUser);

module.exports = router;
