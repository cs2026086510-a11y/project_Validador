/* =============================================
   Admin Dashboard – Frontend Logic
   Loads REAL data from PostgreSQL via API
   ============================================= */

const API_BASE = window.location.origin + '/api';

// Helpers
function getToken() { return sessionStorage.getItem('admin_token'); }
function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:'America/Lima' }) +
    ' ' + date.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit', timeZone:'America/Lima' });
}

function getBadgeClass(action) {
  const map = {
    'LOGIN': 'adm-badge-login', 'ADMIN_LOGIN': 'adm-badge-admin',
    'LOGOUT': 'adm-badge-logout', 'VALIDATION': 'adm-badge-validation',
    'REGISTER': 'adm-badge-register', 'CREATE_ADMIN': 'adm-badge-admin',
    'DEACTIVATE_ADMIN': 'adm-badge-admin'
  };
  return map[action] || 'adm-badge-default';
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `adm-toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; }, 3000);
  setTimeout(() => toast.remove(), 3500);
}

async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  if (!token) { window.location.href = '/admin-login.html'; return null; }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }
  });
  if (res.status === 401 || res.status === 403) {
    sessionStorage.clear();
    window.location.href = '/admin-login.html';
    return null;
  }
  return res;
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  const token = getToken();
  if (!token) { window.location.href = '/admin-login.html'; return; }

  // Fill profile info
  const user = sessionStorage.getItem('admin_user');
  const email = sessionStorage.getItem('admin_email');
  const role = sessionStorage.getItem('admin_role');
  document.getElementById('header-admin-name').textContent = user || email || 'Admin';
  document.getElementById('info-name').textContent = user || '—';
  document.getElementById('info-email').textContent = email || '—';
  document.getElementById('info-role').textContent = (role || 'admin').toUpperCase();
  document.getElementById('info-time').textContent = formatDate(new Date());

  // Buttons
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch(e) {}
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_user');
    sessionStorage.removeItem('admin_email');
    sessionStorage.removeItem('admin_role');
    window.location.href = '/admin-login.html';
  });

  document.getElementById('btn-volver').addEventListener('click', () => {
    window.location.href = '/';
  });

  // Modal
  const modal = document.getElementById('modal-create-admin');
  document.getElementById('btn-create-admin').addEventListener('click', () => modal.hidden = false);
  document.getElementById('modal-close').addEventListener('click', () => modal.hidden = true);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  // Create admin form
  document.getElementById('form-create-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formError = document.getElementById('form-error');
    formError.hidden = true;
    const body = {
      nombre: document.getElementById('new-admin-name').value,
      correo: document.getElementById('new-admin-email').value,
      password: document.getElementById('new-admin-pass').value,
      rol: document.getElementById('new-admin-role').value
    };
    try {
      const res = await apiFetch('/admin/admins', { method: 'POST', body: JSON.stringify(body) });
      if (!res) return;
      if (res.ok) {
        showToast('Administrador creado exitosamente');
        modal.hidden = true;
        e.target.reset();
        loadAdmins();
        loadStats();
      } else {
        const data = await res.json();
        formError.textContent = data.error || 'Error al crear administrador';
        formError.hidden = false;
      }
    } catch(err) {
      formError.textContent = 'Error de conexión';
      formError.hidden = false;
    }
  });

  // Log filters
  document.querySelectorAll('.adm-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadLogs(btn.dataset.filter);
    });
  });

  // Load all data
  await Promise.all([loadStats(), loadAudit(), loadLogs('ALL'), loadAdmins(), loadUsers()]);
});

// ── LOAD STATS ──
async function loadStats() {
  try {
    const res = await apiFetch('/admin/stats');
    if (!res) return;
    const s = await res.json();
    document.getElementById('stat-total-users').textContent = s.totalUsers ?? 0;
    document.getElementById('stat-admins').textContent = s.totalAdmins ?? 0;
    document.getElementById('stat-sql-validations').textContent = s.sqlValidations ?? 0;
    document.getElementById('stat-mongo-validations').textContent = s.mongoValidations ?? 0;
    document.getElementById('stat-sessions').textContent = s.sessions ?? 0;
    document.getElementById('stat-events').textContent = s.totalEvents ?? 0;
  } catch (err) {
    console.error('Error cargando stats:', err);
    document.getElementById('error-banner').hidden = false;
  }
}

// ── LOAD AUDIT (Activity) ──
async function loadAudit() {
  const tbody = document.getElementById('audit-tbody');
  const empty = document.getElementById('audit-empty');
  try {
    const res = await apiFetch('/admin/audit');
    if (!res) return;
    const data = await res.json();
    tbody.innerHTML = '';
    if (!data.length) { empty.hidden = false; return; }
    empty.hidden = true;
    data.slice(0, 50).forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:12px;color:var(--adm-text2);white-space:nowrap;">${formatDate(a.fecha)}</td>
        <td>${a.usuario || '—'}</td>
        <td><span class="adm-badge ${getBadgeClass(a.accion)}">${a.accion}</span></td>
        <td style="font-size:12px;color:var(--adm-text3);font-family:var(--adm-mono);">${a.ip || '—'}</td>
        <td style="font-size:12px;color:var(--adm-text2);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.detalles || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando audit:', err);
    empty.hidden = false;
    empty.textContent = 'No fue posible cargar la información';
  }
}

// ── LOAD LOGS (filtered) ──
async function loadLogs(filter) {
  const tbody = document.getElementById('logs-tbody');
  const empty = document.getElementById('logs-empty');
  try {
    const res = await apiFetch(`/admin/audit?filter=${filter}`);
    if (!res) return;
    const data = await res.json();
    tbody.innerHTML = '';
    if (!data.length) { empty.hidden = false; empty.textContent = 'No existen registros disponibles'; return; }
    empty.hidden = true;
    data.forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:12px;color:var(--adm-text2);white-space:nowrap;">${formatDate(a.fecha)}</td>
        <td>${a.usuario || '—'}</td>
        <td><span class="adm-badge ${getBadgeClass(a.accion)}">${a.accion}</span></td>
        <td style="font-size:12px;color:var(--adm-text2);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.detalles || '—'}</td>
        <td style="font-size:12px;color:var(--adm-text3);font-family:var(--adm-mono);">${a.ip || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando logs:', err);
    empty.hidden = false;
    empty.textContent = 'No fue posible cargar la información';
  }
}

// ── ROLE CHECK ──
const isSuperAdmin = () => sessionStorage.getItem('admin_role') === 'superadmin';

document.addEventListener('DOMContentLoaded', async () => {
  if (isSuperAdmin()) {
    document.getElementById('btn-create-admin').hidden = false;
    document.querySelectorAll('.col-acciones').forEach(el => el.hidden = false);
  }
});

// ── LOAD ADMINS ──
async function loadAdmins() {
  const tbody = document.getElementById('admins-tbody');
  const empty = document.getElementById('admins-empty');
  try {
    const res = await apiFetch('/admin/admins');
    if (!res) return;
    const data = await res.json();
    tbody.innerHTML = '';
    if (!data.length) { empty.hidden = false; return; }
    empty.hidden = true;
    data.forEach(a => {
      const tr = document.createElement('tr');
      const statusClass = a.activo ? 'active-admin' : 'inactive';
      const statusText = a.activo ? 'Activo' : 'Inactivo';
      
      let actionsHTML = '';
      if (isSuperAdmin()) {
        const toggleAction = a.activo ? 'Desactivar' : 'Reactivar';
        const toggleMethod = a.activo ? 'deactivate' : 'reactivate';
        const roleAction = a.rol === 'admin' ? 'Hacer SuperAdmin' : 'Hacer Admin';
        const newRole = a.rol === 'admin' ? 'superadmin' : 'admin';
        
        actionsHTML = `
          <td>
            <button class="adm-btn adm-btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="toggleAdmin('${a.id}', '${toggleMethod}')">${toggleAction}</button>
            <button class="adm-btn adm-btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="changeAdminRole('${a.id}', '${newRole}')">${roleAction}</button>
            <button class="adm-btn adm-btn-danger" style="padding:4px 8px;font-size:12px;" onclick="deleteAdmin('${a.id}')">Eliminar</button>
          </td>
        `;
      }

      tr.innerHTML = `
        <td style="font-weight:500;color:var(--adm-white);">${a.nombre}</td>
        <td>${a.correo}</td>
        <td><span class="adm-badge adm-badge-admin">${(a.rol || 'admin').toUpperCase()}</span></td>
        <td><span class="adm-status"><span class="adm-status-dot ${statusClass}"></span>${statusText}</span></td>
        <td style="font-size:12px;color:var(--adm-text2);">${formatDate(a.last_login)}</td>
        ${actionsHTML}
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando admins:', err);
    empty.hidden = false;
    empty.textContent = 'No fue posible cargar la información';
  }
}

// ── LOAD USERS ──
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  const empty = document.getElementById('users-empty');
  try {
    const res = await apiFetch('/admin/users');
    if (!res) return;
    const data = await res.json();
    tbody.innerHTML = '';
    if (!data.length) { empty.hidden = false; return; }
    empty.hidden = true;
    data.forEach(u => {
      const tr = document.createElement('tr');
      const isOnline = u.is_online;
      const statusClass = isOnline ? 'online' : 'offline';
      const statusText = isOnline ? 'En línea' : 'Desconectado';
      const activoText = u.activo === false ? ' (Desactivado)' : '';
      
      let actionsHTML = '';
      if (isSuperAdmin()) {
        const toggleAction = u.activo !== false ? 'Desactivar' : 'Reactivar';
        const toggleMethod = u.activo !== false ? 'deactivate' : 'reactivate';
        
        actionsHTML = `
          <td>
            <button class="adm-btn adm-btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="toggleUser('${u.id}', '${toggleMethod}')">${toggleAction}</button>
            <button class="adm-btn adm-btn-danger" style="padding:4px 8px;font-size:12px;" onclick="deleteUser('${u.id}')">Eliminar</button>
          </td>
        `;
      }

      tr.innerHTML = `
        <td style="font-weight:500;color:var(--adm-white);">${u.name || '—'}</td>
        <td>${u.email}</td>
        <td style="font-size:12px;color:var(--adm-text2);">${formatDate(u.last_login)}</td>
        <td style="font-size:12px;color:var(--adm-text2);">${formatDate(u.created_at)}</td>
        <td><span class="adm-status"><span class="adm-status-dot ${u.activo === false ? 'inactive' : statusClass}"></span>${statusText}${activoText}</span></td>
        ${actionsHTML}
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando users:', err);
    empty.hidden = false;
    empty.textContent = 'No fue posible cargar la información';
  }
}

// ── ACTIONS (SUPERADMIN ONLY) ──
window.toggleAdmin = async (id, method) => {
  if (!confirm(`¿Estás seguro de ${method === 'deactivate' ? 'desactivar' : 'reactivar'} este administrador?`)) return;
  const res = await apiFetch(`/admin/admins/${id}/${method}`, { method: 'PUT' });
  if (res && res.ok) { showToast('Operación exitosa'); loadAdmins(); loadAudit(); loadLogs('ADMIN'); }
  else if (res) { const data = await res.json(); alert(data.error); }
};

window.changeAdminRole = async (id, rol) => {
  if (!confirm(`¿Cambiar rol a ${rol.toUpperCase()}?`)) return;
  const res = await apiFetch(`/admin/admins/${id}/role`, { method: 'PUT', body: JSON.stringify({ rol }) });
  if (res && res.ok) { showToast('Rol actualizado'); loadAdmins(); loadAudit(); loadLogs('ADMIN'); }
  else if (res) { const data = await res.json(); alert(data.error); }
};

window.deleteAdmin = async (id) => {
  if (!confirm('¿Eliminar administrador DEFINITIVAMENTE?')) return;
  const res = await apiFetch(`/admin/admins/${id}`, { method: 'DELETE' });
  if (res && res.ok) { showToast('Administrador eliminado'); loadAdmins(); loadAudit(); loadLogs('ADMIN'); }
  else if (res) { const data = await res.json(); alert(data.error); }
};

window.toggleUser = async (id, method) => {
  if (!confirm(`¿Estás seguro de ${method === 'deactivate' ? 'desactivar' : 'reactivar'} este usuario?`)) return;
  const res = await apiFetch(`/admin/users/${id}/${method}`, { method: 'PUT' });
  if (res && res.ok) { showToast('Operación exitosa'); loadUsers(); loadAudit(); loadLogs('ADMIN'); }
  else if (res) { const data = await res.json(); alert(data.error); }
};

window.deleteUser = async (id) => {
  if (!confirm('¿Eliminar usuario DEFINITIVAMENTE?')) return;
  const res = await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
  if (res && res.ok) { showToast('Usuario eliminado'); loadUsers(); loadStats(); loadAudit(); loadLogs('ADMIN'); }
  else if (res) { const data = await res.json(); alert(data.error); }
};
