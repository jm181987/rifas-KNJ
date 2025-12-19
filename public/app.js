const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();

// ============ CONFIGURACIÓN MERCADOPAGO REAL ============
const MP_ACCESS_TOKEN = 'APP_USR-5767269400108111-121011-4cffa1d6521c32952b93d4a153bc6568-81252460';
const MP_PUBLIC_KEY = 'APP_USR-6ef35d3e-1d77-4066-adcd-5c520bd96081';

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 10000 }
});

// ============ CONFIGURACIÓN SERVIDOR ============
const DOMINIO = 'http://localhost:3000';
const PUERTO = 3000;

// ============ MIDDLEWARE ============
app.use(cors({
  origin: DOMINIO,
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static('public'));

// ============ BASE DE DATOS ============
const db = new sqlite3.Database('rifas_produccion.db', (err) => {
  if (err) {
    console.error('❌ Error BD:', err.message);
  } else {
    console.log('✅ BD de producción conectada');
    inicializarBD();
  }
});

function inicializarBD() {
  // Tabla premios
  db.run(`
    CREATE TABLE IF NOT EXISTS premios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      descripcion TEXT,
      stock INTEGER DEFAULT 0,
      icono TEXT DEFAULT 'fa-gift',
      activo BOOLEAN DEFAULT 1,
      vendidos INTEGER DEFAULT 0,
      creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla compras
  db.run(`
    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      premio_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      total REAL NOT NULL,
      payment_id TEXT UNIQUE,
      preference_id TEXT,
      status TEXT DEFAULT 'pending',
      status_detail TEXT,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      datos_pago TEXT,
      notificado BOOLEAN DEFAULT 0,
      FOREIGN KEY (premio_id) REFERENCES premios(id)
    )
  `);

  // Tabla para logs de webhooks
  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT,
      tipo TEXT,
      datos TEXT,
      procesado BOOLEAN DEFAULT 0,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insertar premios de ejemplo si no existen
  db.get('SELECT COUNT(*) as count FROM premios', (err, row) => {
    if (err) return;
    
    if (row.count === 0) {
      console.log('📝 Insertando premios de producción...');
      
      const premiosProduccion = [
        ['TV 55" 4K Smart', 299.99, 'Televisor Samsung 4K UHD Smart TV', 50, 'fa-tv'],
        ['iPhone 15 Pro', 999.99, 'iPhone 15 Pro 256GB - Color Titanio Natural', 30, 'fa-mobile-alt'],
        ['PlayStation 5', 499.99, 'Consola PS5 + 2 Juegos + Control Extra', 25, 'fa-gamepad'],
        ['Laptop Gaming', 1299.99, 'ASUS ROG - RTX 4060, 16GB RAM, 1TB SSD', 15, 'fa-laptop'],
        ['Viaje a Cancún', 1499.99, 'Todo incluido 7 días 6 noches - 2 personas', 5, 'fa-plane']
      ];

      const stmt = db.prepare(
        'INSERT INTO premios (nombre, precio, descripcion, stock, icono) VALUES (?, ?, ?, ?, ?)'
      );

      premiosProduccion.forEach(premio => {
        stmt.run(premio, (err) => {
          if (err) console.error('Error:', err.message);
        });
      });
      
      stmt.finalize(() => {
        console.log('✅ Premios de producción listos');
      });
    }
  });
}

// ============ RUTAS API PRINCIPALES ============

// GET /api/premios - PARA LA PÁGINA PRINCIPAL
app.get('/api/premios', (req, res) => {
  console.log('🔍 [API] Solicitando premios para página principal');
  
  db.all(
    `SELECT id, nombre, precio, descripcion, stock, icono, vendidos 
     FROM premios 
     WHERE activo = 1 
     ORDER BY creado DESC`,
    (err, rows) => {
      if (err) {
        console.error('❌ Error /api/premios:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      
      console.log(`✅ [API] Enviando ${rows.length} premios al frontend`);
      res.json(rows);
    }
  );
});

// ============ DASHBOARD ADMIN COMPLETO ============

// GET /admin - Panel de administración COMPLETO
app.get('/admin', (req, res) => {
  // Verificar credenciales
  const { user, pass } = req.query;
  
  const ADMIN_USER = 'admin';
  const ADMIN_PASS = 'admin123';
  
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    // Mostrar formulario de login
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login Admin - Sistema de Rifas</title>
        <style>
          body { font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f7fa; }
          .login-box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); width: 300px; }
          h2 { text-align: center; color: #667eea; margin-bottom: 30px; }
          input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
          button { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="login-box">
          <h2><i class="fas fa-lock"></i> Acceso Admin</h2>
          <form method="GET" action="/admin">
            <input type="text" name="user" placeholder="Usuario" required>
            <input type="password" name="pass" placeholder="Contraseña" required>
            <button type="submit">Entrar</button>
          </form>
          <p style="text-align: center; margin-top: 20px; font-size: 12px; color: #666;">
            Usuario: <strong>admin</strong><br>
            Contraseña: <strong>admin123</strong>
          </p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Si las credenciales son correctas, mostrar dashboard COMPLETO
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Admin Dashboard - Sistema de Rifas</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f7fa; color: #333; }
    
    .admin-container {
      display: flex;
      min-height: 100vh;
    }
    
    .sidebar {
      width: 250px;
      background: #2c3e50;
      color: white;
      padding: 20px 0;
    }
    
    .sidebar-header {
      padding: 20px;
      text-align: center;
      border-bottom: 1px solid #34495e;
    }
    
    .sidebar-menu {
      list-style: none;
      padding: 20px 0;
    }
    
    .sidebar-menu li {
      padding: 15px 25px;
      cursor: pointer;
      transition: background 0.3s;
      border-left: 4px solid transparent;
    }
    
    .sidebar-menu li:hover, .sidebar-menu li.active {
      background: #34495e;
      border-left: 4px solid #667eea;
    }
    
    .sidebar-menu i {
      width: 25px;
      margin-right: 10px;
    }
    
    .main-content {
      flex: 1;
      padding: 30px;
      overflow-y: auto;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #eee;
    }
    
    .card {
      background: white;
      border-radius: 10px;
      padding: 25px;
      box-shadow: 0 3px 10px rgba(0,0,0,0.1);
      margin-bottom: 30px;
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #555;
    }
    
    input, textarea, select {
      width: 100%;
      padding: 12px 15px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 16px;
      transition: border 0.3s;
    }
    
    input:focus, textarea:focus, select:focus {
      border-color: #667eea;
      outline: none;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    
    textarea {
      height: 100px;
      resize: vertical;
    }
    
    .btn {
      padding: 12px 25px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: all 0.3s;
    }
    
    .btn-primary {
      background: #667eea;
      color: white;
    }
    
    .btn-primary:hover {
      background: #5a6fd8;
      transform: translateY(-2px);
    }
    
    .btn-success {
      background: #4CAF50;
      color: white;
    }
    
    .btn-danger {
      background: #f44336;
      color: white;
    }
    
    .icons-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }
    
    .icon-option {
      padding: 15px;
      text-align: center;
      border: 2px solid #eee;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .icon-option:hover {
      border-color: #667eea;
      background: #f8f9ff;
    }
    
    .icon-option.selected {
      border-color: #667eea;
      background: #667eea;
      color: white;
    }
    
    .alert {
      padding: 15px;
      border-radius: 6px;
      margin-bottom: 20px;
      display: none;
    }
    
    .alert-success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    
    .alert-error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    
    th, td {
      padding: 15px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    
    th {
      background: #f8f9fa;
      font-weight: 600;
      color: #555;
    }
    
    tr:hover {
      background: #f8f9fa;
    }
    
    .badge {
      padding: 5px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    
    .action-buttons {
      display: flex;
      gap: 8px;
    }
    
    .action-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    
    .edit-btn { background: #ffc107; color: #333; }
    .delete-btn { background: #dc3545; color: white; }
    .toggle-btn { background: #6c757d; color: white; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    
    .stat-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 10px;
      text-align: center;
    }
    
    .stat-number {
      font-size: 2.5rem;
      font-weight: bold;
      margin-bottom: 10px;
    }
    
    .stat-label {
      color: #666;
      font-size: 0.9rem;
    }
    
    /* Estilos para números de rifa */
    .numeros-grid-admin {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 15px;
      max-height: 300px;
      overflow-y: auto;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 10px;
    }
    
    .numero-badge {
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      min-width: 50px;
      text-align: center;
      cursor: default;
      transition: transform 0.2s;
    }
    
    .numero-badge:hover {
      transform: translateY(-2px);
    }
    
    .numero-disponible { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .numero-reservado { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
    .numero-vendido { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    
    .seccion {
      display: none;
    }
    
    .seccion.active {
      display: block;
    }
  </style>
</head>
<body>
  <div class="admin-container">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <h2><i class="fas fa-crown"></i> Admin Panel</h2>
        <p style="font-size: 14px; color: #bdc3c7; margin-top: 5px;">Sistema de Rifas</p>
      </div>
      
      <ul class="sidebar-menu">
        <li class="active" onclick="mostrarSeccion('dashboard')">
          <i class="fas fa-tachometer-alt"></i> Dashboard
        </li>
        <li onclick="mostrarSeccion('agregar-premio')">
          <i class="fas fa-plus-circle"></i> Agregar Premio
        </li>
        <li onclick="mostrarSeccion('lista-premios')">
          <i class="fas fa-gifts"></i> Ver Premios
        </li>
        <li onclick="mostrarSeccion('ver-compras')">
          <i class="fas fa-shopping-cart"></i> Ver Compras
        </li>
        <li onclick="mostrarSeccion('ver-numeros')">
          <i class="fas fa-hashtag"></i> Ver Números
        </li>
        <li onclick="mostrarSeccion('realizar-sorteo')">
          <i class="fas fa-dice"></i> Realizar Sorteo
        </li>
        <li onclick="window.location.href='/'">
          <i class="fas fa-home"></i> Ir al Sitio
        </li>
        <li onclick="window.location.href='/admin?logout=true'">
          <i class="fas fa-sign-out-alt"></i> Salir
        </li>
      </ul>
    </div>
    
    <!-- Contenido Principal -->
    <div class="main-content">
      <!-- Header -->
      <div class="header">
        <h1 id="titulo-seccion">Dashboard</h1>
        <div style="color: #666;">
          <i class="fas fa-user-circle"></i> admin
        </div>
      </div>
      
      <!-- Alertas -->
      <div class="alert" id="alert"></div>
      
      <!-- Secciones -->
      
      <!-- 1. DASHBOARD -->
      <div id="dashboard" class="seccion active">
        <div class="card">
          <h2><i class="fas fa-chart-line"></i> Estadísticas del Sistema</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-number" id="total-premios-admin" style="color: #667eea;">0</div>
              <div class="stat-label">Premios Activos</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" id="total-stock-admin" style="color: #4CAF50;">0</div>
              <div class="stat-label">Rifas Totales</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" id="total-compras-admin" style="color: #FF9800;">0</div>
              <div class="stat-label">Compras Totales</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" id="total-vendidos-admin" style="color: #9C27B0;">0</div>
              <div class="stat-label">Rifas Vendidas</div>
            </div>
          </div>
        </div>
        
        <div class="card">
          <h2><i class="fas fa-cogs"></i> Acciones Rápidas</h2>
          <div style="display: flex; gap: 15px; margin-top: 20px;">
            <button class="btn btn-primary" onclick="mostrarSeccion('agregar-premio')">
              <i class="fas fa-plus"></i> Nuevo Premio
            </button>
            <button class="btn btn-success" onclick="actualizarEstadisticas()">
              <i class="fas fa-sync-alt"></i> Actualizar
            </button>
            <button class="btn btn-danger" onclick="resetearDemo()">
              <i class="fas fa-redo"></i> Resetear Demo
            </button>
          </div>
        </div>
        
        <div class="card">
          <h2><i class="fas fa-info-circle"></i> Información del Sistema</h2>
          <div style="margin-top: 15px;">
            <p><strong>URL del Sitio:</strong> <a href="/" target="_blank">http://localhost:3000</a></p>
            <p><strong>MercadoPago:</strong> <span id="mp-status" style="color: #4CAF50;">Conectado</span></p>
            <p><strong>Base de Datos:</strong> rifas_produccion.db</p>
            <p><strong>Modo:</strong> Producción</p>
            <p><strong>Números de Rifa:</strong> <span style="color: #4CAF50;">Activado</span></p>
          </div>
        </div>
      </div>
      
      <!-- 2. AGREGAR PREMIO -->
      <div id="agregar-premio" class="seccion">
        <div class="card">
          <h2><i class="fas fa-plus-circle"></i> Agregar Nuevo Premio</h2>
          <form id="form-premio">
            <div class="form-group">
              <label for="nombre"><i class="fas fa-tag"></i> Nombre del Premio *</label>
              <input type="text" id="nombre" placeholder="Ej: iPhone 15 Pro Max" required>
            </div>
            
            <div class="form-group">
              <label for="precio"><i class="fas fa-dollar-sign"></i> Precio por Rifa *</label>
              <input type="number" id="precio" min="1" step="0.01" placeholder="Ej: 299.99" required>
            </div>
            
            <div class="form-group">
              <label for="descripcion"><i class="fas fa-align-left"></i> Descripción</label>
              <textarea id="descripcion" placeholder="Describe el premio..."></textarea>
            </div>
            
            <div class="form-group">
              <label for="stock"><i class="fas fa-box"></i> Stock Disponible *</label>
              <input type="number" id="stock" min="1" placeholder="Ej: 50" required>
            </div>
            
            <div class="form-group">
              <label><i class="fas fa-icons"></i> Ícono del Premio</label>
              <div class="icons-grid" id="iconos-grid">
                <!-- Los íconos se cargan con JavaScript -->
              </div>
              <input type="hidden" id="icono" value="fa-gift">
            </div>
            
            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 15px;">
              <i class="fas fa-save"></i> Guardar Premio
            </button>
          </form>
        </div>
      </div>
      
      <!-- 3. LISTA DE PREMIOS -->
      <div id="lista-premios" class="seccion">
        <div class="card">
          <h2><i class="fas fa-gifts"></i> Premios Existentes</h2>
          
          <div style="margin-bottom: 20px;">
            <input type="text" id="buscar-premio" placeholder="Buscar premio..." style="width: 300px; padding: 10px;">
            <button class="btn btn-success" onclick="cargarPremiosAdmin()" style="margin-left: 10px;">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>
          
          <table id="tabla-premios">
            <thead>
              <tr>
                <th>ID</th>
                <th>Ícono</th>
                <th>Nombre</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Vendidos</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <!-- Se carga con JavaScript -->
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- 4. VER COMPRAS -->
      <div id="ver-compras" class="seccion">
        <div class="card">
          <h2><i class="fas fa-shopping-cart"></i> Compras Realizadas</h2>
          <table id="tabla-compras">
            <thead>
              <tr>
                <th>ID</th>
                <th>Fecha</th>
                <th>Email</th>
                <th>Premio</th>
                <th>Cantidad</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <!-- Se carga con JavaScript -->
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- 5. VER NÚMEROS -->
      <div id="ver-numeros" class="seccion">
        <div class="card">
          <h2><i class="fas fa-hashtag"></i> Números de Rifas</h2>
          
          <div class="form-group">
            <label><i class="fas fa-gift"></i> Seleccionar Premio:</label>
            <select id="select-premio-numeros" style="width: 400px; padding: 10px;">
              <option value="">-- Selecciona un premio --</option>
            </select>
            <button class="btn btn-success" onclick="cargarNumerosPremio()" style="margin-left: 10px;">
              <i class="fas fa-search"></i> Ver Números
            </button>
          </div>
          
          <div id="numeros-premio-container">
            <p style="text-align: center; color: #666; padding: 40px;">
              Selecciona un premio para ver sus números
            </p>
          </div>
        </div>
      </div>
      
      <!-- 6. REALIZAR SORTEO -->
      <div id="realizar-sorteo" class="seccion">
        <div class="card">
          <h2><i class="fas fa-dice"></i> Realizar Sorteo</h2>
          
          <div class="form-group">
            <label><i class="fas fa-gift"></i> Seleccionar Premio:</label>
            <select id="select-premio-sorteo" style="width: 400px; padding: 10px;" onchange="cargarInfoPremioSorteo()">
              <option value="">-- Selecciona un premio para sortear --</option>
            </select>
          </div>
          
          <div id="info-premio-sorteo" style="display: none; background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3 id="nombre-premio-sorteo"></h3>
            <div class="stats-grid" style="margin-top: 10px;">
              <div class="stat-card">
                <div class="stat-number" id="total-vendidos-sorteo">0</div>
                <div class="stat-label">Números Vendidos</div>
              </div>
              <div class="stat-card">
                <div class="stat-number" id="total-participantes-sorteo">0</div>
                <div class="stat-label">Participantes Únicos</div>
              </div>
              <div class="stat-card">
                <div class="stat-number" id="disponibles-sorteo">0</div>
                <div class="stat-label">Disponibles</div>
              </div>
            </div>
            
            <div style="margin-top: 20px;">
              <label><i class="fas fa-crown"></i> Cantidad de Ganadores:</label>
              <input type="number" id="cantidad-ganadores" min="1" value="1" style="width: 100px; padding: 10px;">
            </div>
            
            <div style="margin-top: 20px;">
              <label><i class="fas fa-random"></i> Método de Sorteo:</label>
              <select id="metodo-sorteo" style="width: 300px; padding: 10px;">
                <option value="aleatorio">Aleatorio Simple</option>
                <option value="sistema_numeros">Por Número (Orden ascendente)</option>
                <option value="fecha_compra">Por Fecha de Compra (Más antiguos primero)</option>
              </select>
            </div>
            
            <div style="margin-top: 30px;">
              <button class="btn btn-success" onclick="realizarSorteo()" style="padding: 15px 30px; font-size: 18px;">
                <i class="fas fa-dice"></i> REALIZAR SORTEO
              </button>
              <button class="btn btn-primary" onclick="verHistorialSorteo()" style="margin-left: 10px;">
                <i class="fas fa-history"></i> Ver Historial
              </button>
            </div>
          </div>
          
          <div id="resultado-sorteo" style="display: none; margin-top: 30px; padding: 20px; background: #e8f5e9; border-radius: 10px;">
            <!-- Resultado del sorteo aparecerá aquí -->
          </div>
          
          <div id="historial-sorteos" style="display: none; margin-top: 30px;">
            <!-- Historial aparecerá aquí -->
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    // ============ CONFIGURACIÓN ============
    const API_URL = window.location.origin;
    let premiosAdmin = [];
    
    // Íconos disponibles
    const iconosDisponibles = [
      'fa-gift', 'fa-tv', 'fa-mobile-alt', 'fa-gamepad', 'fa-laptop',
      'fa-headphones', 'fa-clock', 'fa-bicycle', 'fa-plane', 'fa-car',
      'fa-camera', 'fa-tshirt', 'fa-shoe-prints', 'fa-wine-bottle',
      'fa-utensils', 'fa-music', 'fa-book', 'fa-dumbbell', 'fa-umbrella-beach',
      'fa-gem', 'fa-ring', 'fa-ticket-alt', 'fa-star', 'fa-trophy'
    ];
    
    // ============ FUNCIONES PRINCIPALES ============
    
    // Mostrar/ocultar secciones CORREGIDO
    function mostrarSeccion(seccionId) {
      console.log('Mostrando sección:', seccionId);
      
      // Ocultar todas las secciones
      document.querySelectorAll('.seccion').forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
      });
      
      // Mostrar la seleccionada
      const seccion = document.getElementById(seccionId);
      if (seccion) {
        seccion.style.display = 'block';
        seccion.classList.add('active');
      }
      
      // Actualizar título
      const titulos = {
        'dashboard': 'Dashboard',
        'agregar-premio': 'Agregar Premio',
        'lista-premios': 'Lista de Premios',
        'ver-compras': 'Ver Compras',
        'ver-numeros': 'Ver Números',
        'realizar-sorteo': 'Realizar Sorteo'
      };
      
      const tituloElemento = document.getElementById('titulo-seccion');
      if (tituloElemento) {
        tituloElemento.textContent = titulos[seccionId] || 'Dashboard';
      }
      
      // Actualizar menu activo
      document.querySelectorAll('.sidebar-menu li').forEach(li => {
        li.classList.remove('active');
      });
      
      // Encontrar y activar el elemento del menú correspondiente
      const menuItems = document.querySelectorAll('.sidebar-menu li');
      menuItems.forEach(item => {
        if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(seccionId)) {
          item.classList.add('active');
        }
      });
      
      // Cargar datos si es necesario
      if (seccionId === 'dashboard') {
        actualizarEstadisticas();
      } else if (seccionId === 'lista-premios') {
        cargarPremiosAdmin();
      } else if (seccionId === 'ver-compras') {
        cargarCompras();
      } else if (seccionId === 'ver-numeros') {
        cargarSelectPremiosNumeros();
      } else if (seccionId === 'realizar-sorteo') {
        cargarSelectPremiosSorteo();
        const infoSorteo = document.getElementById('info-premio-sorteo');
        const resultSorteo = document.getElementById('resultado-sorteo');
        const historialSorteo = document.getElementById('historial-sorteos');
        
        if (infoSorteo) infoSorteo.style.display = 'none';
        if (resultSorteo) resultSorteo.style.display = 'none';
        if (historialSorteo) historialSorteo.style.display = 'none';
      }
      
      console.log('Sección activa:', document.querySelector('.seccion.active')?.id);
    }
    
    // Inicializar íconos
    function inicializarIconos() {
      const grid = document.getElementById('iconos-grid');
      if (!grid) return;
      
      grid.innerHTML = '';
      
      iconosDisponibles.forEach(icono => {
        const div = document.createElement('div');
        div.className = 'icon-option';
        div.innerHTML = '<i class="fas ' + icono + ' fa-2x"></i>';
        div.title = icono;
        div.onclick = function() {
          document.querySelectorAll('.icon-option').forEach(el => {
            el.classList.remove('selected');
          });
          this.classList.add('selected');
          document.getElementById('icono').value = icono;
        };
        grid.appendChild(div);
      });
      
      // Seleccionar el primero por defecto
      if (grid.firstChild) {
        grid.firstChild.classList.add('selected');
      }
    }
    
    // Mostrar alerta
    function mostrarAlerta(mensaje, tipo = 'success', tiempo = 5000) {
      const alert = document.getElementById('alert');
      alert.className = 'alert alert-' + tipo;
      alert.innerHTML = '<i class="fas ' + (tipo === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle') + '"></i> ' + mensaje;
      alert.style.display = 'block';
      
      setTimeout(() => {
        alert.style.display = 'none';
      }, tiempo);
    }
    
    // ============ DASHBOARD FUNCTIONS ============
    
    // Actualizar estadísticas del dashboard
    async function actualizarEstadisticas() {
      try {
        console.log('📊 Actualizando estadísticas...');
        
        // Obtener estadísticas de premios
        const response = await fetch(API_URL + '/api/estadisticas');
        const data = await response.json();
        
        if (data.success) {
          // Actualizar UI
          document.getElementById('total-premios-admin').textContent = data.estadisticas.total_premios || 0;
          document.getElementById('total-stock-admin').textContent = data.estadisticas.total_stock || 0;
          document.getElementById('total-compras-admin').textContent = data.estadisticas.total_compras || 0;
          document.getElementById('total-vendidos-admin').textContent = data.estadisticas.total_vendidos || 0;
          
          console.log('✅ Estadísticas actualizadas');
        } else {
          console.error('Error en estadísticas:', data.error);
        }
      } catch (error) {
        console.error('Error actualizando estadísticas:', error);
      }
    }
    
    // ============ FORMULARIO DE PREMIOS ============
    
    // Enviar formulario
    document.getElementById('form-premio')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const premio = {
        nombre: document.getElementById('nombre').value.trim(),
        precio: parseFloat(document.getElementById('precio').value),
        descripcion: document.getElementById('descripcion').value.trim(),
        stock: parseInt(document.getElementById('stock').value),
        icono: document.getElementById('icono').value
      };
      
      // Validación básica
      if (!premio.nombre || premio.precio <= 0 || premio.stock <= 0) {
        mostrarAlerta('Completa todos los campos correctamente', 'error');
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/admin/premios', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(premio)
        });
        
        const data = await response.json();
        
        if (response.ok) {
          mostrarAlerta('Premio "' + premio.nombre + '" agregado exitosamente! ID: ' + data.id, 'success');
          
          // Limpiar formulario
          this.reset();
          document.getElementById('icono').value = 'fa-gift';
          document.querySelectorAll('.icon-option').forEach(el => {
            el.classList.remove('selected');
          });
          if (document.querySelector('.icon-option')) {
            document.querySelector('.icon-option').classList.add('selected');
          }
          
          // Actualizar lista si está visible
          if (document.getElementById('lista-premios').style.display === 'block') {
            cargarPremiosAdmin();
          }
          
          // Actualizar estadísticas del dashboard
          actualizarEstadisticas();
          
        } else {
          mostrarAlerta('Error: ' + (data.error || 'No se pudo agregar el premio'), 'error');
        }
        
      } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('Error de conexión con el servidor', 'error');
      }
    });
    
    // ============ LISTA DE PREMIOS ============
    
    // Cargar premios para admin
    async function cargarPremiosAdmin() {
      try {
        const response = await fetch(API_URL + '/api/admin/premios/todos');
        premiosAdmin = await response.json();
        
        const tbody = document.querySelector('#tabla-premios tbody');
        const busqueda = document.getElementById('buscar-premio')?.value.toLowerCase() || '';
        
        tbody.innerHTML = '';
        
        premiosAdmin
          .filter(premio => premio.nombre.toLowerCase().includes(busqueda))
          .forEach(premio => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + premio.id + '</td>' +
                          '<td><i class="fas ' + (premio.icono || 'fa-gift') + ' fa-2x"></i></td>' +
                          '<td><strong>' + premio.nombre + '</strong><br>' +
                          '<small style="color: #666;">' + (premio.descripcion || 'Sin descripción') + '</small></td>' +
                          '<td>$' + premio.precio + '</td>' +
                          '<td><span class="badge ' + (premio.stock > 20 ? 'badge-success' : premio.stock > 0 ? 'badge-warning' : 'badge-danger') + '">' + premio.stock + '</span></td>' +
                          '<td>' + (premio.vendidos || 0) + '</td>' +
                          '<td><span class="badge ' + (premio.activo ? 'badge-success' : 'badge-danger') + '">' + (premio.activo ? 'Activo' : 'Inactivo') + '</span></td>' +
                          '<td><div class="action-buttons">' +
                          '<button class="action-btn edit-btn" onclick="editarPremio(' + premio.id + ')">' +
                          '<i class="fas fa-edit"></i></button>' +
                          '<button class="action-btn delete-btn" onclick="eliminarPremio(' + premio.id + ')">' +
                          '<i class="fas fa-trash"></i></button></div></td>';
            tbody.appendChild(tr);
          });
          
      } catch (error) {
        console.error('Error cargando premios:', error);
        mostrarAlerta('Error al cargar los premios', 'error');
      }
    }
    
    // Editar premio
    async function editarPremio(id) {
      const premio = premiosAdmin.find(p => p.id === id);
      if (!premio) return;
      
      // Llenar formulario
      document.getElementById('nombre').value = premio.nombre;
      document.getElementById('precio').value = premio.precio;
      document.getElementById('descripcion').value = premio.descripcion || '';
      document.getElementById('stock').value = premio.stock;
      document.getElementById('icono').value = premio.icono || 'fa-gift';
      
      // Seleccionar ícono
      document.querySelectorAll('.icon-option').forEach(el => {
        el.classList.remove('selected');
        if (el.querySelector('i').className.includes(premio.icono || 'fa-gift')) {
          el.classList.add('selected');
        }
      });
      
      // Cambiar a sección de agregar premio
      mostrarSeccion('agregar-premio');
      
      // Cambiar texto del botón
      const form = document.getElementById('form-premio');
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Actualizar Premio';
      submitBtn.onclick = async function(e) {
        e.preventDefault();
        
        const premioActualizado = {
          nombre: document.getElementById('nombre').value.trim(),
          precio: parseFloat(document.getElementById('precio').value),
          descripcion: document.getElementById('descripcion').value.trim(),
          stock: parseInt(document.getElementById('stock').value),
          icono: document.getElementById('icono').value
        };
        
        try {
          const response = await fetch(API_URL + '/api/admin/premios/' + id, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(premioActualizado)
          });
          
          const data = await response.json();
          
          if (response.ok) {
            mostrarAlerta('Premio actualizado exitosamente', 'success');
            
            // Restaurar formulario
            form.reset();
            submitBtn.innerHTML = originalText;
            submitBtn.onclick = null;
            
            // Actualizar lista
            cargarPremiosAdmin();
            actualizarEstadisticas();
            
          } else {
            mostrarAlerta('Error: ' + data.error, 'error');
          }
          
        } catch (error) {
          console.error('Error:', error);
          mostrarAlerta('Error de conexión', 'error');
        }
      };
    }
    
    // Eliminar premio
    async function eliminarPremio(id) {
      if (!confirm('¿Estás seguro de eliminar este premio? Esta acción no se puede deshacer.')) {
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/admin/premios/' + id, {
          method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
          mostrarAlerta('Premio eliminado exitosamente', 'success');
          cargarPremiosAdmin();
          actualizarEstadisticas();
        } else {
          mostrarAlerta('Error: ' + data.error, 'error');
        }
        
      } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('Error de conexión', 'error');
      }
    }
    
    // ============ COMPRAS ============
    
    // Cargar compras
    async function cargarCompras() {
      try {
        const response = await fetch(API_URL + '/api/admin/compras');
        const compras = await response.json();
        
        const tbody = document.querySelector('#tabla-compras tbody');
        tbody.innerHTML = '';
        
        compras.forEach(compra => {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + compra.id + '</td>' +
                        '<td>' + new Date(compra.fecha_creacion).toLocaleDateString() + '</td>' +
                        '<td>' + compra.email + '</td>' +
                        '<td>' + (compra.premio_nombre || 'Premio ' + compra.premio_id) + '</td>' +
                        '<td>' + compra.cantidad + '</td>' +
                        '<td>$' + compra.total + '</td>' +
                        '<td><span class="badge ' + (compra.status === 'approved' ? 'badge-success' : 
                                                     compra.status === 'pending' ? 'badge-warning' : 
                                                     'badge-danger') + '">' + (compra.status || 'pending') + '</span></td>';
          tbody.appendChild(tr);
        });
        
      } catch (error) {
        console.error('Error cargando compras:', error);
        mostrarAlerta('Error al cargar las compras', 'error');
      }
    }
    
    // ============ NÚMEROS DE RIFA ============
    
    // Cargar select de premios para números
    async function cargarSelectPremiosNumeros() {
      try {
        const response = await fetch(API_URL + '/api/admin/premios/todos');
        const premios = await response.json();
        
        const select = document.getElementById('select-premio-numeros');
        select.innerHTML = '<option value="">-- Selecciona un premio --</option>';
        
        premios.forEach(premio => {
          const option = document.createElement('option');
          option.value = premio.id;
          option.textContent = premio.id + ' - ' + premio.nombre + ' (Stock: ' + premio.stock + ', Vendidos: ' + (premio.vendidos || 0) + ')';
          select.appendChild(option);
        });
        
      } catch (error) {
        console.error('Error cargando premios para números:', error);
      }
    }
    
    // Cargar números de un premio
    async function cargarNumerosPremio() {
      const premioId = document.getElementById('select-premio-numeros').value;
      if (!premioId) {
        mostrarAlerta('Por favor, selecciona un premio', 'error');
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/numeros/' + premioId + '?estado=all');
        const data = await response.json();
        
        const container = document.getElementById('numeros-premio-container');
        
        if (!data.numeros || data.numeros.length === 0) {
          container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">' +
                                '<i class="fas fa-exclamation-circle fa-3x" style="margin-bottom: 20px;"></i>' +
                                '<h3>No hay números registrados para este premio</h3>' +
                                '<p>Los números se crean automáticamente al agregar el premio.</p></div>';
          return;
        }
        
        // Agrupar por estado
        const porEstado = {
          disponible: data.numeros.filter(n => n.estado === 'disponible'),
          reservado: data.numeros.filter(n => n.estado === 'reservado' || n.estado === 'reservado_pago'),
          vendido: data.numeros.filter(n => n.estado === 'vendido')
        };
        
        // Obtener nombre del premio seleccionado
        const select = document.getElementById('select-premio-numeros');
        const premioNombre = select.options[select.selectedIndex].text;
        
        let html = '<div style="margin-bottom: 20px;">' +
                   '<h3>' + premioNombre + '</h3>' +
                   '<div class="stats-grid" style="margin-top: 15px;">' +
                   '<div class="stat-card">' +
                   '<div class="stat-number" style="color: #4CAF50;">' + porEstado.disponible.length + '</div>' +
                   '<div class="stat-label">Disponibles</div></div>' +
                   '<div class="stat-card">' +
                   '<div class="stat-number" style="color: #FF9800;">' + porEstado.reservado.length + '</div>' +
                   '<div class="stat-label">Reservados</div></div>' +
                   '<div class="stat-card">' +
                   '<div class="stat-number" style="color: #f44336;">' + porEstado.vendido.length + '</div>' +
                   '<div class="stat-label">Vendidos</div></div></div></div>' +
                   '<div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">' +
                   '<h4>Todos los números (' + data.numeros.length + ')</h4>' +
                   '<div class="numeros-grid-admin">';
        
        // Mostrar todos los números con colores según estado
        data.numeros.sort((a, b) => a.numero - b.numero).forEach(numero => {
          let clase = 'numero-badge ';
          let titulo = 'Número ' + numero.numero;
          
          if (numero.estado === 'disponible') {
            clase += 'numero-disponible';
            titulo += ' - Disponible';
          } else if (numero.estado === 'reservado' || numero.estado === 'reservado_pago') {
            clase += 'numero-reservado';
            titulo += ' - Reservado';
            if (numero.email) {
              titulo += ' por: ' + numero.email;
            }
            if (numero.fecha_reserva) {
              titulo += ' (' + new Date(numero.fecha_reserva).toLocaleString() + ')';
            }
          } else if (numero.estado === 'vendido') {
            clase += 'numero-vendido';
            titulo += ' - Vendido';
            if (numero.email) {
              titulo += ' a: ' + numero.email;
            }
            if (numero.fecha_venta) {
              titulo += ' (' + new Date(numero.fecha_venta).toLocaleString() + ')';
            }
          }
          
          html += '<div class="' + clase + '" title="' + titulo + '">' + numero.numero + '</div>';
        });
        
        html += '</div></div>' +
                '<div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">' +
                '<div style="display: flex; align-items: center; gap: 5px;">' +
                '<div style="width: 15px; height: 15px; background: #d4edda; border: 1px solid #c3e6cb;"></div>' +
                '<span>Disponible</span></div>' +
                '<div style="display: flex; align-items: center; gap: 5px;">' +
                '<div style="width: 15px; height: 15px; background: #fff3cd; border: 1px solid #ffeaa7;"></div>' +
                '<span>Reservado</span></div>' +
                '<div style="display: flex; align-items: center; gap: 5px;">' +
                '<div style="width: 15px; height: 15px; background: #f8d7da; border: 1px solid #f5c6cb;"></div>' +
                '<span>Vendido</span></div></div>';
        
        container.innerHTML = html;
        
      } catch (error) {
        console.error('Error cargando números:', error);
        document.getElementById('numeros-premio-container').innerHTML = 
          '<div class="alert alert-error"><i class="fas fa-exclamation-circle"></i>' +
          'Error al cargar los números: ' + error.message + '</div>';
      }
    }
    
    // ============ SORTEOS ============
    
    // Cargar select de premios para sorteo
    async function cargarSelectPremiosSorteo() {
      try {
        const response = await fetch(API_URL + '/api/admin/premios/todos');
        const premios = await response.json();
        
        const select = document.getElementById('select-premio-sorteo');
        select.innerHTML = '<option value="">-- Selecciona un premio para sortear --</option>';
        
        // Mostrar solo premios que tienen números vendidos
        premios.forEach(premio => {
          if (premio.vendidos > 0) {
            const option = document.createElement('option');
            option.value = premio.id;
            option.textContent = premio.id + ' - ' + premio.nombre + ' (Vendidos: ' + (premio.vendidos || 0) + ')';
            option.dataset.vendidos = premio.vendidos || 0;
            select.appendChild(option);
          }
        });
        
      } catch (error) {
        console.error('Error cargando premios para sorteo:', error);
      }
    }
    
    // Cargar información del premio seleccionado para sorteo
    async function cargarInfoPremioSorteo() {
      const premioId = document.getElementById('select-premio-sorteo').value;
      if (!premioId) {
        document.getElementById('info-premio-sorteo').style.display = 'none';
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/sorteo/' + premioId);
        const data = await response.json();
        
        if (data.success) {
          const select = document.getElementById('select-premio-sorteo');
          const option = select.options[select.selectedIndex];
          
          document.getElementById('nombre-premio-sorteo').textContent = data.premio.nombre;
          document.getElementById('total-vendidos-sorteo').textContent = data.total_numeros;
          document.getElementById('total-participantes-sorteo').textContent = data.total_participantes;
          document.getElementById('disponibles-sorteo').textContent = data.premio.stock || 0;
          
          // Ajustar cantidad máxima de ganadores
          const cantidadInput = document.getElementById('cantidad-ganadores');
          cantidadInput.max = data.total_numeros;
          if (parseInt(cantidadInput.value) > data.total_numeros) {
            cantidadInput.value = data.total_numeros;
          }
          
          document.getElementById('info-premio-sorteo').style.display = 'block';
          document.getElementById('resultado-sorteo').style.display = 'none';
          document.getElementById('historial-sorteos').style.display = 'none';
          
        } else {
          mostrarAlerta('Error al cargar información del premio', 'error');
        }
        
      } catch (error) {
        console.error('Error cargando información del premio:', error);
        mostrarAlerta('Error al cargar información del premio', 'error');
      }
    }
    
    // Realizar sorteo
    async function realizarSorteo() {
      const premioId = document.getElementById('select-premio-sorteo').value;
      const cantidadGanadores = parseInt(document.getElementById('cantidad-ganadores').value);
      const metodo = document.getElementById('metodo-sorteo').value;
      
      if (!premioId) {
        mostrarAlerta('Por favor, selecciona un premio', 'error');
        return;
      }
      
      if (!cantidadGanadores || cantidadGanadores < 1) {
        mostrarAlerta('Por favor, ingresa una cantidad válida de ganadores', 'error');
        return;
      }
      
      if (!confirm('¿Estás seguro de realizar el sorteo para ' + cantidadGanadores + ' ganador(es)?\\n\\nEsta acción no se puede deshacer.')) {
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/sorteo/realizar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            premioId: parseInt(premioId),
            cantidadGanadores: cantidadGanadores,
            metodo: metodo
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          mostrarAlerta('¡Sorteo realizado exitosamente! ' + data.cantidad_ganadores + ' ganador(es) seleccionado(s)', 'success');
          
          // Mostrar resultados
          const resultadoDiv = document.getElementById('resultado-sorteo');
          let html = '<h3 style="color: #2E7D32;">🎉 ¡SORTEO REALIZADO EXITOSAMENTE!</h3>' +
                     '<p><strong>Premio:</strong> ' + data.premio + '</p>' +
                     '<p><strong>Fecha:</strong> ' + new Date(data.fecha_sorteo).toLocaleString() + '</p>' +
                     '<p><strong>Método:</strong> ' + (data.metodo === 'aleatorio' ? 'Aleatorio Simple' : 
                                                       data.metodo === 'sistema_numeros' ? 'Por Número' : 
                                                       'Por Fecha de Compra') + '</p>' +
                     '<p><strong>Participantes:</strong> ' + data.total_participantes + '</p>' +
                     '<p><strong>Ganadores:</strong> ' + data.cantidad_ganadores + '</p>' +
                     '<h4 style="margin-top: 20px;">🏆 GANADORES:</h4>' +
                     '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 15px;">';
          
          data.ganadores.forEach((ganador, index) => {
            html += '<div style="background: white; padding: 15px; border-radius: 8px; text-align: center; border: 2px solid #4CAF50;">' +
                    '<div style="font-size: 24px; font-weight: bold; color: #4CAF50;">' + (index + 1) + 'º</div>' +
                    '<div style="font-size: 20px; font-weight: bold; margin: 5px 0;">Nº ' + ganador.numero + '</div>' +
                    '<div style="font-size: 12px; color: #666; word-break: break-all;">' + ganador.email + '</div></div>';
          });
          
          html += '</div>' +
                  '<div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px;">' +
                  '<h5>📋 Números Ganadores:</h5>' +
                  '<p style="font-size: 18px;">' + data.numeros_ganadores.join(', ') + '</p></div>' +
                  '<button class="btn btn-primary" onclick="window.print()" style="margin-top: 20px;">' +
                  '<i class="fas fa-print"></i> Imprimir Resultados</button>';
          
          resultadoDiv.innerHTML = html;
          resultadoDiv.style.display = 'block';
          
          // Ocultar historial si estaba visible
          document.getElementById('historial-sorteos').style.display = 'none';
          
          // Recargar información del premio
          cargarInfoPremioSorteo();
          
        } else {
          mostrarAlerta('Error: ' + (data.error || 'No se pudo realizar el sorteo'), 'error');
        }
        
      } catch (error) {
        console.error('Error realizando sorteo:', error);
        mostrarAlerta('Error de conexión con el servidor', 'error');
      }
    }
    
    // Ver historial de sorteos
    async function verHistorialSorteo() {
      const premioId = document.getElementById('select-premio-sorteo').value;
      
      if (!premioId) {
        mostrarAlerta('Por favor, selecciona un premio', 'error');
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/sorteo/historial/' + premioId);
        const data = await response.json();
        
        const historialDiv = document.getElementById('historial-sorteos');
        
        if (data.success && data.total_sorteos > 0) {
          let html = '<h3>📜 Historial de Sorteos</h3>' +
                     '<p><strong>Total de sorteos realizados:</strong> ' + data.total_sorteos + '</p>' +
                     '<div style="margin-top: 20px;">';
          
          data.sorteos.forEach(sorteo => {
            const resultado = sorteo.resultado;
            html += '<div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 15px; border-left: 5px solid #667eea;">' +
                    '<div style="display: flex; justify-content: space-between;">' +
                    '<h4>' + new Date(sorteo.fecha_sorteo).toLocaleString() + '</h4>' +
                    '<span class="badge" style="background: #4CAF50; color: white;">' + sorteo.cantidad_ganadores + ' ganador(es)</span></div>' +
                    '<p><strong>Método:</strong> ' + (sorteo.metodo === 'aleatorio' ? 'Aleatorio Simple' : 
                                                      sorteo.metodo === 'sistema_numeros' ? 'Por Número' : 
                                                      'Por Fecha de Compra') + '</p>' +
                    '<p><strong>Participantes:</strong> ' + sorteo.total_participantes + '</p>' +
                    '<div style="margin-top: 10px;"><strong>Ganadores:</strong>' +
                    '<div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">';
            
            resultado.ganadores.forEach(ganador => {
              html += '<span style="background: #e8f5e9; padding: 5px 10px; border-radius: 20px; font-size: 12px;">Nº ' + ganador.numero + '</span>';
            });
            
            html += '</div></div></div>';
          });
          
          html += '</div>';
          
        } else {
          html = '<div style="text-align: center; padding: 40px; color: #666;">' +
                 '<i class="fas fa-history fa-3x" style="margin-bottom: 20px;"></i>' +
                 '<h3>No hay sorteos realizados</h3>' +
                 '<p>Aún no se ha realizado ningún sorteo para este premio.</p></div>';
        }
        
        historialDiv.innerHTML = html;
        historialDiv.style.display = 'block';
        document.getElementById('resultado-sorteo').style.display = 'none';
        
      } catch (error) {
        console.error('Error cargando historial:', error);
        mostrarAlerta('Error al cargar el historial de sorteos', 'error');
      }
    }
    
    // Resetear demo
    async function resetearDemo() {
      if (!confirm('¿Resetear todos los datos de prueba? Esto eliminará todas las compras y reseteará el stock.')) {
        return;
      }
      
      try {
        const response = await fetch(API_URL + '/api/reset-demo', {
          method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
          mostrarAlerta('Datos de prueba reseteados exitosamente', 'success');
          actualizarEstadisticas();
          cargarPremiosAdmin();
          cargarCompras();
        } else {
          mostrarAlerta('Error: ' + data.error, 'error');
        }
        
      } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('Error de conexión', 'error');
      }
    }
    
    // ============ INICIALIZACIÓN ============
    
    document.addEventListener('DOMContentLoaded', function() {
      console.log('Admin panel cargado');
      
      // Inicializar íconos
      inicializarIconos();
      
      // Cargar estadísticas iniciales
      actualizarEstadisticas();
      
      // Agregar búsqueda en tiempo real
      const buscarInput = document.getElementById('buscar-premio');
      if (buscarInput) {
        buscarInput.addEventListener('input', cargarPremiosAdmin);
      }
      
      // Forzar que dashboard sea visible inicialmente
      mostrarSeccion('dashboard');
    });
  </script>
</body>
</html>
`);
});

// ============ RUTAS DE ADMIN QUE FALTAN ============

// POST /api/admin/premios - Crear nuevo premio
app.post('/api/admin/premios', (req, res) => {
  const { nombre, precio, descripcion, stock, icono } = req.body;
  
  console.log('📝 [ADMIN] Creando nuevo premio:', { nombre, precio, stock });
  
  // Validaciones
  if (!nombre || !precio || !stock) {
    return res.status(400).json({ 
      error: 'Faltan campos requeridos',
      requeridos: ['nombre', 'precio', 'stock']
    });
  }
  
  if (precio <= 0) {
    return res.status(400).json({ error: 'El precio debe ser mayor a 0' });
  }
  
  if (stock <= 0) {
    return res.status(400).json({ error: 'El stock debe ser mayor a 0' });
  }
  
  db.run(
    `INSERT INTO premios (nombre, precio, descripcion, stock, icono) 
     VALUES (?, ?, ?, ?, ?)`,
    [nombre, parseFloat(precio), descripcion || '', parseInt(stock), icono || 'fa-gift'],
    function(err) {
      if (err) {
        console.error('❌ Error creando premio:', err);
        return res.status(500).json({ error: 'Error al crear premio' });
      }
      
      const nuevoId = this.lastID;
      console.log(`✅ [ADMIN] Premio creado: ID=${nuevoId}, "${nombre}"`);
      
      res.status(201).json({
        success: true,
        id: nuevoId,
        message: 'Premio creado exitosamente',
        premio: { 
          id: nuevoId, 
          nombre, 
          precio: parseFloat(precio), 
          descripcion, 
          stock: parseInt(stock), 
          icono: icono || 'fa-gift' 
        }
      });
    }
  );
});

// PUT /api/admin/premios/:id - Actualizar premio
app.put('/api/admin/premios/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, precio, descripcion, stock, icono } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'ID requerido' });
  }
  
  const campos = [];
  const valores = [];
  
  if (nombre !== undefined) { 
    campos.push('nombre = ?'); 
    valores.push(nombre); 
  }
  
  if (precio !== undefined) { 
    campos.push('precio = ?'); 
    valores.push(parseFloat(precio)); 
  }
  
  if (descripcion !== undefined) { 
    campos.push('descripcion = ?'); 
    valores.push(descripcion); 
  }
  
  if (stock !== undefined) { 
    campos.push('stock = ?'); 
    valores.push(parseInt(stock)); 
  }
  
  if (icono !== undefined) { 
    campos.push('icono = ?'); 
    valores.push(icono); 
  }
  
  if (campos.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }
  
  valores.push(id);
  
  db.run(
    `UPDATE premios SET ${campos.join(', ')} WHERE id = ?`,
    valores,
    function(err) {
      if (err) {
        console.error('Error actualizando premio:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Premio no encontrado' });
      }
      
      console.log(`✅ [ADMIN] Premio actualizado: ID=${id}, cambios=${this.changes}`);
      
      res.json({
        success: true,
        message: 'Premio actualizado exitosamente',
        cambios: this.changes
      });
    }
  );
});

// DELETE /api/admin/premios/:id - Eliminar premio
app.delete('/api/admin/premios/:id', (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'ID requerido' });
  }
  
  console.log(`🗑️ [ADMIN] Intentando eliminar premio ID=${id}`);
  
  // Primero verificamos si hay compras asociadas
  db.get('SELECT COUNT(*) as count FROM compras WHERE premio_id = ?', [id], (err, row) => {
    if (err) {
      console.error('Error verificando compras:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
    
    if (row.count > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el premio',
        razon: 'Tiene compras asociadas',
        compras: row.count
      });
    }
    
    // Eliminar premio
    db.run('DELETE FROM premios WHERE id = ?', [id], function(err) {
      if (err) {
        console.error('Error eliminando premio:', err);
        return res.status(500).json({ error: 'Error al eliminar premio' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Premio no encontrado' });
      }
      
      console.log(`✅ [ADMIN] Premio eliminado: ID=${id}`);
      
      res.json({
        success: true,
        message: 'Premio eliminado exitosamente',
        id: id
      });
    });
  });
});

// GET /api/admin/premios/todos - Obtener todos los premios
app.get('/api/admin/premios/todos', (req, res) => {
  db.all(
    `SELECT id, nombre, precio, descripcion, stock, icono, activo, vendidos
     FROM premios 
     ORDER BY id DESC`,
    (err, rows) => {
      if (err) {
        console.error('Error obteniendo premios:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      res.json(rows);
    }
  );
});

// GET /api/admin/compras - Obtener todas las compras
app.get('/api/admin/compras', (req, res) => {
  db.all(`
    SELECT c.*, p.nombre as premio_nombre 
    FROM compras c
    LEFT JOIN premios p ON c.premio_id = p.id
    ORDER BY c.fecha_creacion DESC
    LIMIT 100
  `, (err, rows) => {
    if (err) {
      console.error('Error obteniendo compras:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
    res.json(rows);
  });
});

// POST /api/reset-demo - Resetear datos de prueba
app.post('/api/reset-demo', (req, res) => {
  db.serialize(() => {
    // Eliminar todas las compras
    db.run('DELETE FROM compras', (err) => {
      if (err) {
        console.error('Error eliminando compras:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      
      // Resetear stock de todos los premios a 100
      db.run('UPDATE premios SET stock = 100, vendidos = 0', (err) => {
        if (err) {
          console.error('Error reseteando stock:', err);
          return res.status(500).json({ error: 'Error interno' });
        }
        
        res.json({
          success: true,
          message: 'Datos de prueba reseteados correctamente',
          compras_eliminadas: 'Todas',
          stock_reseteado: 'Todos a 100 unidades'
        });
      });
    });
  });
});

// ============ ESTADÍSTICAS PARA DASHBOARD ============

// GET /api/estadisticas - Obtener estadísticas para el dashboard
app.get('/api/estadisticas', (req, res) => {
  const estadisticas = {};
  
  // 1. Estadísticas de premios
  db.get(`
    SELECT 
      COUNT(*) as total_premios,
      SUM(stock) as total_stock,
      SUM(vendidos) as total_vendidos
    FROM premios 
    WHERE activo = 1
  `, (err, row) => {
    if (err) {
      console.error('Error estadísticas premios:', err);
      estadisticas.premios = { error: err.message };
    } else {
      estadisticas.total_premios = row.total_premios || 0;
      estadisticas.total_stock = row.total_stock || 0;
      estadisticas.total_vendidos = row.total_vendidos || 0;
    }
    
    // 2. Estadísticas de compras
    db.get(`
      SELECT 
        COUNT(*) as total_compras,
        SUM(total) as total_recaudado,
        SUM(CASE WHEN status = 'approved' THEN total ELSE 0 END) as total_aprobado
      FROM compras
    `, (err, row) => {
      if (err) {
        console.error('Error estadísticas compras:', err);
      } else {
        estadisticas.total_compras = row.total_compras || 0;
        estadisticas.total_recaudado = row.total_recaudado || 0;
        estadisticas.total_aprobado = row.total_aprobado || 0;
      }
      
      // 3. Últimas compras
      db.all(`
        SELECT c.*, p.nombre as premio_nombre 
        FROM compras c
        LEFT JOIN premios p ON c.premio_id = p.id
        ORDER BY c.fecha_creacion DESC
        LIMIT 5
      `, (err, rows) => {
        if (!err) {
          estadisticas.ultimas_compras = rows;
        }
        
        res.json({
          success: true,
          estadisticas: estadisticas,
          timestamp: new Date().toISOString()
        });
      });
    });
  });
});

// ============ RUTAS API PARA DASHBOARD (NUEVAS) ============

// GET /api/numeros/:premioId - Obtener números de un premio
app.get('/api/numeros/:premioId', (req, res) => {
  const { premioId } = req.params;
  const { estado } = req.query; // 'all', 'disponible', 'reservado', 'vendido'
  
  console.log(`🔢 [API] Solicitando números para premio ${premioId}, estado: ${estado || 'all'}`);
  
  // Primero verificamos que el premio exista
  db.get('SELECT * FROM premios WHERE id = ?', [premioId], (err, premio) => {
    if (err) {
      console.error('Error obteniendo premio:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
    
    if (!premio) {
      return res.status(404).json({ error: 'Premio no encontrado' });
    }
    
    // Crear números ficticios para demostración
    // En una implementación real, esto vendría de una tabla de números
    const totalNumeros = premio.stock + (premio.vendidos || 0);
    const numeros = [];
    
    for (let i = 1; i <= totalNumeros; i++) {
      let estadoNumero = 'disponible';
      let email = null;
      let fecha_reserva = null;
      let fecha_venta = null;
      
      // Simular algunos números vendidos
      if (premio.vendidos && i <= premio.vendidos) {
        estadoNumero = 'vendido';
        email = `comprador${i}@ejemplo.com`;
        fecha_venta = new Date(Date.now() - i * 3600000).toISOString();
      }
      // Simular algunos números reservados
      else if (i <= premio.vendidos + 5 && i > premio.vendidos) {
        estadoNumero = 'reservado';
        email = `reserva${i}@ejemplo.com`;
        fecha_reserva = new Date(Date.now() - i * 1800000).toISOString();
      }
      
      numeros.push({
        numero: i,
        estado: estadoNumero,
        email: email,
        fecha_reserva: fecha_reserva,
        fecha_venta: fecha_venta,
        premio_id: parseInt(premioId),
        premio_nombre: premio.nombre
      });
    }
    
    // Filtrar por estado si se especifica
    let numerosFiltrados = numeros;
    if (estado && estado !== 'all') {
      numerosFiltrados = numeros.filter(n => n.estado === estado);
    }
    
    res.json({
      success: true,
      premio: {
        id: premio.id,
        nombre: premio.nombre,
        total_numeros: totalNumeros
      },
      numeros: numerosFiltrados,
      estadisticas: {
        total: numeros.length,
        disponibles: numeros.filter(n => n.estado === 'disponible').length,
        reservados: numeros.filter(n => n.estado === 'reservado').length,
        vendidos: numeros.filter(n => n.estado === 'vendido').length
      }
    });
  });
});

// GET /api/sorteo/:premioId - Información para sorteo
app.get('/api/sorteo/:premioId', (req, res) => {
  const { premioId } = req.params;
  
  console.log(`🎲 [API] Información para sorteo del premio ${premioId}`);
  
  // Obtener información del premio
  db.get('SELECT * FROM premios WHERE id = ?', [premioId], (err, premio) => {
    if (err) {
      console.error('Error obteniendo premio:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
    
    if (!premio) {
      return res.status(404).json({ error: 'Premio no encontrado' });
    }
    
    // Obtener participantes (compras aprobadas)
    db.all(
      `SELECT DISTINCT email, COUNT(*) as boletos 
       FROM compras 
       WHERE premio_id = ? AND status = 'approved'
       GROUP BY email`,
      [premioId],
      (err, participantes) => {
        if (err) {
          console.error('Error obteniendo participantes:', err);
          return res.status(500).json({ error: 'Error interno' });
        }
        
        // Obtener total de boletos vendidos
        db.get(
          `SELECT SUM(cantidad) as total 
           FROM compras 
           WHERE premio_id = ? AND status = 'approved'`,
          [premioId],
          (err, row) => {
            const totalNumeros = row?.total || 0;
            
            res.json({
              success: true,
              premio: {
                id: premio.id,
                nombre: premio.nombre,
                stock: premio.stock,
                vendidos: premio.vendidos || 0
              },
              total_numeros: totalNumeros,
              total_participantes: participantes.length,
              participantes: participantes,
              disponible_para_sorteo: totalNumeros > 0
            });
          }
        );
      }
    );
  });
});

// POST /api/sorteo/realizar - Realizar sorteo
app.post('/api/sorteo/realizar', (req, res) => {
  const { premioId, cantidadGanadores, metodo } = req.body;
  
  console.log(`🎲 [API] Realizando sorteo para premio ${premioId}, ${cantidadGanadores} ganadores, método: ${metodo}`);
  
  if (!premioId || !cantidadGanadores || !metodo) {
    return res.status(400).json({ 
      error: 'Datos incompletos',
      requeridos: ['premioId', 'cantidadGanadores', 'metodo']
    });
  }
  
  // Obtener información del premio
  db.get('SELECT * FROM premios WHERE id = ?', [premioId], (err, premio) => {
    if (err) {
      console.error('Error obteniendo premio:', err);
      return res.status(500).json({ error: 'Error interno' });
    }
    
    if (!premio) {
      return res.status(404).json({ error: 'Premio no encontrado' });
    }
    
    // Obtener participantes (simulado para demostración)
    const participantes = [
      { email: 'cliente1@ejemplo.com', boletos: 5, numeros: [1, 2, 3, 4, 5] },
      { email: 'cliente2@ejemplo.com', boletos: 3, numeros: [6, 7, 8] },
      { email: 'cliente3@ejemplo.com', boletos: 2, numeros: [9, 10] },
      { email: 'cliente4@ejemplo.com', boletos: 4, numeros: [11, 12, 13, 14] },
      { email: 'cliente5@ejemplo.com', boletos: 1, numeros: [15] }
    ];
    
    // Seleccionar ganadores según el método
    let ganadores = [];
    const todosNumeros = participantes.flatMap(p => 
      p.numeros.map(n => ({ numero: n, email: p.email }))
    );
    
    if (metodo === 'aleatorio') {
      // Selección aleatoria
      const shuffled = [...todosNumeros].sort(() => 0.5 - Math.random());
      ganadores = shuffled.slice(0, Math.min(cantidadGanadores, todosNumeros.length));
    } else if (metodo === 'sistema_numeros') {
      // Por número (orden ascendente)
      const sorted = [...todosNumeros].sort((a, b) => a.numero - b.numero);
      ganadores = sorted.slice(0, Math.min(cantidadGanadores, sorted.length));
    } else if (metodo === 'fecha_compra') {
      // Por fecha de compra (simulado)
      ganadores = todosNumeros.slice(0, Math.min(cantidadGanadores, todosNumeros.length));
    }
    
    res.json({
      success: true,
      premio: premio.nombre,
      cantidad_ganadores: ganadores.length,
      total_participantes: participantes.length,
      total_numeros: todosNumeros.length,
      metodo: metodo,
      fecha_sorteo: new Date().toISOString(),
      ganadores: ganadores,
      numeros_ganadores: ganadores.map(g => g.numero),
      mensaje: `Sorteo realizado exitosamente. ${ganadores.length} ganador(es) seleccionado(s).`
    });
  });
});

// GET /api/sorteo/historial/:premioId - Historial de sorteos
app.get('/api/sorteo/historial/:premioId', (req, res) => {
  const { premioId } = req.params;
  
  console.log(`📜 [API] Historial de sorteos para premio ${premioId}`);
  
  // Simular historial de sorteos
  const historial = [
    {
      id: 1,
      premio_id: parseInt(premioId),
      fecha_sorteo: new Date(Date.now() - 86400000).toISOString(), // Ayer
      cantidad_ganadores: 1,
      total_participantes: 15,
      metodo: 'aleatorio',
      resultado: {
        ganadores: [
          { numero: 7, email: 'ganador1@ejemplo.com' }
        ]
      }
    },
    {
      id: 2,
      premio_id: parseInt(premioId),
      fecha_sorteo: new Date(Date.now() - 172800000).toISOString(), // Hace 2 días
      cantidad_ganadores: 2,
      total_participantes: 22,
      metodo: 'sistema_numeros',
      resultado: {
        ganadores: [
          { numero: 1, email: 'ganador2@ejemplo.com' },
          { numero: 2, email: 'ganador3@ejemplo.com' }
        ]
      }
    }
  ];
  
  res.json({
    success: true,
    premio_id: premioId,
    total_sorteos: historial.length,
    sorteos: historial
  });
});

// ============ RUTAS DE PAGO REAL (MANTIENES LAS QUE YA TIENES) ============

// POST /api/crear-pago - Crear pago REAL con MercadoPago
app.post('/api/crear-pago', async (req, res) => {
  try {
    const { premioId, email, cantidad, nombre, telefono } = req.body;

    console.log('🔄 Creando pago real para:', { premioId, email, cantidad });

    // Validaciones
    if (!premioId || !email || !cantidad) {
      return res.status(400).json({ 
        error: 'Datos incompletos',
        requeridos: ['premioId', 'email', 'cantidad']
      });
    }

    if (cantidad < 1 || cantidad > 100) {
      return res.status(400).json({ error: 'Cantidad debe ser entre 1 y 100' });
    }

    // 1. Verificar stock del premio
    const premio = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM premios WHERE id = ? AND activo = 1',
        [premioId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!premio) {
      return res.status(400).json({ 
        error: 'Premio no disponible',
        detalles: 'Premio no encontrado o inactivo'
      });
    }

    if (premio.stock < cantidad) {
      return res.status(400).json({ 
        error: 'Stock insuficiente',
        stock_disponible: premio.stock,
        solicitado: cantidad
      });
    }

    // 2. Calcular total
    const total = premio.precio * cantidad;
    
    // 3. Crear preferencia en MercadoPago REAL
    const preference = new Preference(client);
    
    const preferenceData = {
      body: {
        items: [
          {
            id: premio.id.toString(),
            title: `Rifa: ${premio.nombre}`,
            description: premio.descripcion?.substring(0, 250) || 'Participación en rifa',
            category_id: 'entertainment',
            quantity: parseInt(cantidad),
            currency_id: 'ARS',
            unit_price: parseFloat(premio.precio)
          }
        ],
        payer: {
          email: email,
          name: nombre || email.split('@')[0],
          phone: telefono ? { number: telefono } : undefined
        },
        payment_methods: {
          excluded_payment_methods: [{ id: 'atm' }],
          excluded_payment_types: [{ id: 'atm' }],
          installments: 1
        },
        back_urls: {
          success: `${DOMINIO}/success`,
          failure: `${DOMINIO}/error`,
          pending: `${DOMINIO}/pending`
        },
        auto_return: 'approved',
        notification_url: `${DOMINIO}/api/webhook`,
        statement_descriptor: 'RIFAS*TUEMPRESA',
        external_reference: `rifa_${premio.id}_${Date.now()}`,
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: new Date(Date.now() + 3600000).toISOString(),
        metadata: {
          premio_id: premio.id,
          premio_nombre: premio.nombre,
          cantidad: cantidad,
          email: email,
          sistema: 'rifas_produccion'
        }
      }
    };

    console.log('📤 Enviando a MercadoPago:', preferenceData.body.items[0]);

    const result = await preference.create(preferenceData);
    
    console.log('✅ Respuesta MercadoPago:', result.id);

    // 4. Registrar compra en nuestra BD
    const compraId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO compras 
         (premio_id, email, cantidad, total, payment_id, preference_id, status) 
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [premioId, email, cantidad, total, result.id, result.id, 'pending'],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    console.log(`✅ Compra registrada: ID=${compraId}, Payment=${result.id}`);

    // 5. Devolver datos al frontend
    res.json({
      success: true,
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      compra_id: compraId,
      items: result.items,
      total: total,
      modo: 'produccion',
      public_key: MP_PUBLIC_KEY
    });

  } catch (error) {
    console.error('❌ Error en /api/crear-pago:', error);
    
    if (error.message?.includes('Invalid access_token')) {
      return res.status(500).json({ 
        error: 'Error de configuración',
        mensaje: 'Token de MercadoPago inválido. Verifica tus credenciales.'
      });
    }
    
    res.status(500).json({ 
      error: 'Error al crear el pago',
      mensaje: error.message || 'Error desconocido'
    });
  }
});

// ============ WEBHOOK MERCADOPAGO REAL ============

// POST /api/webhook - Webhook para notificaciones de MercadoPago
app.post('/api/webhook', async (req, res) => {
  try {
    console.log('📥 Webhook recibido:', req.body);
    
    // Loggear el webhook
    db.run(
      'INSERT INTO webhook_logs (payment_id, tipo, datos) VALUES (?, ?, ?)',
      [req.body?.data?.id || 'unknown', req.body?.type || 'unknown', JSON.stringify(req.body)]
    );

    // Procesar solo notificaciones de pago
    if (req.body.type === 'payment') {
      const paymentId = req.body.data.id;
      
      console.log(`🔍 Procesando pago: ${paymentId}`);
      
      // 1. Consultar el pago a MercadoPago
      const payment = new Payment(client);
      const mpPayment = await payment.get({ id: paymentId });
      
      console.log(`📊 Estado pago ${paymentId}:`, mpPayment.status);
      
      // 2. Buscar compra en nuestra BD
      const compra = await new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM compras WHERE payment_id = ? OR preference_id = ?',
          [paymentId, paymentId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (compra) {
        // 3. Actualizar estado de la compra
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE compras 
             SET status = ?, 
                 status_detail = ?,
                 fecha_actualizacion = CURRENT_TIMESTAMP,
                 datos_pago = ?,
                 notificado = 1
             WHERE id = ?`,
            [
              mpPayment.status,
              mpPayment.status_detail,
              JSON.stringify(mpPayment),
              compra.id
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // 4. Si el pago fue aprobado, actualizar stock y vendidos
        if (mpPayment.status === 'approved') {
          console.log(`✅ Pago aprobado: ${paymentId}`);
          
          // Actualizar stock y vendidos del premio
          db.serialize(() => {
            // Restar del stock
            db.run(
              'UPDATE premios SET stock = stock - ?, vendidos = vendidos + ? WHERE id = ?',
              [compra.cantidad, compra.cantidad, compra.premio_id],
              (err) => {
                if (err) console.error('Error actualizando stock:', err);
                else console.log(`📈 Stock actualizado para premio ${compra.premio_id}`);
              }
            );
          });

          // 5. Enviar email de confirmación (puedes implementar después)
          // await enviarEmailConfirmacion(compra.email, compra, mpPayment);
          
        } else if (mpPayment.status === 'rejected' || mpPayment.status === 'cancelled') {
          console.log(`❌ Pago rechazado: ${paymentId}`);
          // No liberamos stock aquí porque no lo reservamos antes
        }
      } else {
        console.warn(`⚠️ Pago no encontrado en BD: ${paymentId}`);
        
        // Intentar crear la compra si no existe
        if (mpPayment.metadata?.premio_id) {
          const metadata = mpPayment.metadata;
          const total = mpPayment.transaction_amount || 0;
          
          db.run(
            `INSERT INTO compras 
             (premio_id, email, cantidad, total, payment_id, preference_id, status, datos_pago) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              metadata.premio_id,
              mpPayment.payer?.email || 'desconocido',
              metadata.cantidad || 1,
              total,
              paymentId,
              paymentId,
              mpPayment.status,
              JSON.stringify(mpPayment)
            ],
            (err) => {
              if (err) console.error('Error creando compra desde webhook:', err);
              else console.log(`📝 Compra creada desde webhook: ${paymentId}`);
            }
          );
        }
      }
      
      // Marcar como procesado
      db.run(
        'UPDATE webhook_logs SET procesado = 1 WHERE payment_id = ?',
        [paymentId]
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

// ============ VERIFICAR ESTADO DE PAGO ============

// GET /api/verificar-pago/:paymentId - Verificar estado de un pago
app.get('/api/verificar-pago/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    console.log(`🔍 Verificando pago: ${paymentId}`);
    
    // 1. Buscar en nuestra BD primero
    const compra = await new Promise((resolve, reject) => {
      db.get(
        `SELECT c.*, p.nombre as premio_nombre 
         FROM compras c 
         JOIN premios p ON c.premio_id = p.id 
         WHERE c.payment_id = ? OR c.preference_id = ?`,
        [paymentId, paymentId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!compra) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    // 2. Consultar a MercadoPago para estado actual
    try {
      const payment = new Payment(client);
      const mpPayment = await payment.get({ id: paymentId });
      
      // 3. Si el estado cambió, actualizar nuestra BD
      if (mpPayment.status !== compra.status) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE compras 
             SET status = ?, 
                 status_detail = ?,
                 fecha_actualizacion = CURRENT_TIMESTAMP,
                 datos_pago = ?
             WHERE id = ?`,
            [mpPayment.status, mpPayment.status_detail, JSON.stringify(mpPayment), compra.id],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // 4. Si se aprobó, actualizar stock y vendidos
        if (mpPayment.status === 'approved' && compra.status !== 'approved') {
          db.run(
            'UPDATE premios SET stock = stock - ?, vendidos = vendidos + ? WHERE id = ?',
            [compra.cantidad, compra.cantidad, compra.premio_id],
            (err) => {
              if (err) console.error('Error actualizando stock:', err);
            }
          );
        }
      }

      res.json({
        success: true,
        status: mpPayment.status,
        status_detail: mpPayment.status_detail,
        payment: {
          id: mpPayment.id,
          status: mpPayment.status,
          status_detail: mpPayment.status_detail,
          transaction_amount: mpPayment.transaction_amount,
          date_approved: mpPayment.date_approved,
          payment_method: mpPayment.payment_method?.id
        },
        compra: {
          ...compra,
          status: mpPayment.status
        }
      });

    } catch (mpError) {
      // Si falla la consulta a MP, devolver estado de nuestra BD
      console.error('Error consultando MercadoPago:', mpError);
      
      res.json({
        success: true,
        status: compra.status,
        payment_id: paymentId,
        message: 'Estado obtenido de base de datos local',
        compra: compra
      });
    }

  } catch (error) {
    console.error('❌ Error en /api/verificar-pago:', error);
    res.status(500).json({ 
      error: 'Error al verificar el pago',
      message: error.message 
    });
  }
});

// ============ RUTAS DE RESULTADO ============

// GET /success - Pago exitoso
app.get('/success', async (req, res) => {
  const { payment_id, preference_id, collection_id } = req.query;
  const paymentId = payment_id || preference_id || collection_id;
  
  if (paymentId) {
    console.log(`✅ Usuario redirigido a success: ${paymentId}`);
    
    // Verificar estado del pago
    try {
      const payment = new Payment(client);
      const mpPayment = await payment.get({ id: paymentId });
      
      if (mpPayment.status === 'approved') {
        // Buscar compra
        db.get(
          'SELECT c.*, p.nombre as premio_nombre FROM compras c JOIN premios p ON c.premio_id = p.id WHERE c.payment_id = ? OR c.preference_id = ?',
          [paymentId, paymentId],
          (err, compra) => {
            if (!err && compra) {
              res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>¡Pago Exitoso! - Sistema de Rifas</title>
                  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                  <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                      background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
                      min-height: 100vh;
                      display: flex;
                      justify-content: center;
                      align-items: center;
                      padding: 20px;
                    }
                    .success-box {
                      background: white;
                      border-radius: 20px;
                      padding: 50px;
                      text-align: center;
                      box-shadow: 0 20px 50px rgba(0,0,0,0.3);
                      max-width: 600px;
                      width: 100%;
                    }
                    .success-icon {
                      font-size: 5rem;
                      color: #4CAF50;
                      margin-bottom: 20px;
                      animation: bounce 1s;
                    }
                    @keyframes bounce {
                      0%, 20%, 60%, 100% { transform: translateY(0); }
                      40% { transform: translateY(-20px); }
                      80% { transform: translateY(-10px); }
                    }
                    h1 { color: #2D3047; margin-bottom: 20px; }
                    p { color: #666; margin-bottom: 15px; line-height: 1.6; }
                    .compra-info {
                      background: #f8f9fa;
                      padding: 20px;
                      border-radius: 10px;
                      margin: 25px 0;
                      text-align: left;
                    }
                    .btn {
                      display: inline-block;
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                      color: white;
                      padding: 15px 30px;
                      border-radius: 10px;
                      text-decoration: none;
                      font-weight: 600;
                      margin: 10px;
                      transition: transform 0.3s;
                    }
                    .btn:hover { transform: translateY(-3px); }
                  </style>
                </head>
                <body>
                  <div class="success-box">
                    <div class="success-icon">
                      <i class="fas fa-check-circle"></i>
                    </div>
                    <h1>¡Pago Exitoso! 🎉</h1>
                    <p>Tu compra ha sido procesada correctamente.</p>
                    
                    <div class="compra-info">
                      <p><strong>ID de Transacción:</strong> ${paymentId.substring(0, 15)}...</p>
                      <p><strong>Premio:</strong> ${compra.premio_nombre}</p>
                      <p><strong>Cantidad:</strong> ${compra.cantidad} rifa(s)</p>
                      <p><strong>Total:</strong> $${compra.total}</p>
                      <p><strong>Email:</strong> ${compra.email}</p>
                    </div>
                    
                    <p>Recibirás un correo con los detalles de tu compra.</p>
                    <p style="font-size: 0.9rem; color: #888;">
                      <i class="fas fa-info-circle"></i>
                      El sorteo se realizará próximamente. ¡Mucha suerte!
                    </p>
                    
                    <a href="/" class="btn">
                      <i class="fas fa-home"></i> Volver al Inicio
                    </a>
                  </div>
                </body>
                </html>
              `);
            } else {
              res.sendFile(path.join(__dirname, 'public', 'success.html'));
            }
          }
        );
      } else {
        res.sendFile(path.join(__dirname, 'public', 'success.html'));
      }
    } catch (error) {
      console.error('Error verificando pago en success:', error);
      res.sendFile(path.join(__dirname, 'public', 'success.html'));
    }
  } else {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
  }
});

// GET /pending - Pago pendiente
app.get('/pending', (req, res) => {
  const { payment_id } = req.query;
  
  if (payment_id) {
    console.log(`⏳ Pago pendiente: ${payment_id}`);
  }
  
  res.sendFile(path.join(__dirname, 'public', 'pending.html'));
});

// GET /error - Error en pago
app.get('/error', (req, res) => {
  const { payment_id } = req.query;
  
  if (payment_id) {
    console.log(`❌ Error en pago: ${payment_id}`);
  }
  
  res.sendFile(path.join(__dirname, 'public', 'error.html'));
});

// ============ RUTAS DE DIAGNÓSTICO ADICIONALES ============

// GET /api/debug-webhooks - Ver webhooks recibidos
app.get('/api/debug-webhooks', (req, res) => {
  db.all(
    `SELECT * FROM webhook_logs ORDER BY fecha DESC LIMIT 50`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        total: rows.length,
        webhooks: rows,
        timestamp: new Date().toISOString()
      });
    }
  );
});

// GET /api/debug-compras - Ver todas las compras para diagnóstico
app.get('/api/debug-compras', (req, res) => {
  db.all(
    `SELECT c.*, p.nombre as premio_nombre 
     FROM compras c 
     LEFT JOIN premios p ON c.premio_id = p.id 
     ORDER BY c.fecha_creacion DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        total_compras: rows.length,
        compras: rows,
        estadisticas: {
          aprobados: rows.filter(c => c.status === 'approved').length,
          pendientes: rows.filter(c => c.status === 'pending').length,
          rechazados: rows.filter(c => c.status === 'rejected').length
        }
      });
    }
  );
});

// GET /api/debug-sistema - Estado completo del sistema
app.get('/api/debug-sistema', (req, res) => {
  const sistemaInfo = {
    timestamp: new Date().toISOString(),
    servidor: {
      puerto: PUERTO,
      dominio: DOMINIO,
      modo: 'produccion'
    },
    mercadopago: {
      token: MP_ACCESS_TOKEN ? 'Configurado' : 'No configurado',
      public_key: MP_PUBLIC_KEY ? 'Configurado' : 'No configurado'
    }
  };
  
  // Obtener estadísticas de la base de datos
  db.serialize(() => {
    db.get('SELECT COUNT(*) as total FROM premios', (err, premiosRow) => {
      if (!err) sistemaInfo.premios = premiosRow.total;
      
      db.get('SELECT COUNT(*) as total FROM compras', (err, comprasRow) => {
        if (!err) sistemaInfo.compras = comprasRow.total;
        
        db.get('SELECT COUNT(*) as total FROM webhook_logs', (err, webhooksRow) => {
          if (!err) sistemaInfo.webhooks = webhooksRow.total;
          
          res.json({
            success: true,
            sistema: sistemaInfo,
            mensaje: 'Estado del sistema obtenido correctamente'
          });
        });
      });
    });
  });
});

// POST /api/debug-reset-webhook/:id - Reprocesar un webhook
app.post('/api/debug-reset-webhook/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Obtener el webhook
    const webhook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM webhook_logs WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook no encontrado' });
    }
    
    // Parsear datos del webhook
    const datos = JSON.parse(webhook.datos);
    
    // Simular el procesamiento del webhook
    if (datos.type === 'payment') {
      const paymentId = datos.data.id;
      console.log(`🔄 Reprocesando webhook ${id} para payment ${paymentId}`);
      
      // Aquí puedes llamar manualmente al lógica del webhook
      const payment = new Payment(client);
      const mpPayment = await payment.get({ id: paymentId });
      
      res.json({
        success: true,
        message: `Webhook ${id} reprocesado manualmente`,
        payment_id: paymentId,
        status: mpPayment.status,
        original_webhook: datos
      });
    } else {
      res.json({
        success: true,
        message: `Webhook ${id} no es de tipo payment`,
        tipo: datos.type
      });
    }
    
  } catch (error) {
    console.error('Error reprocesando webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/test-mercadopago - Test de conexión con MercadoPago
app.get('/api/test-mercadopago', async (req, res) => {
  try {
    const payment = new Payment(client);
    
    // Intentar obtener un pago de prueba (usamos un ID que no existe para solo testear la conexión)
    try {
      await payment.get({ id: '1234567890' });
    } catch (error) {
      // Esperamos un error 404, lo que significa que la conexión funciona
      if (error.message.includes('404') || error.message.includes('not found')) {
        return res.json({
          success: true,
          message: 'Conexión con MercadoPago exitosa',
          status: 'Conectado',
          token_valido: true
        });
      }
      
      // Otros errores pueden indicar problemas de autenticación
      throw error;
    }
    
  } catch (error) {
    console.error('Error test MercadoPago:', error);
    
    let mensaje = 'Error de conexión';
    if (error.message.includes('401') || error.message.includes('authentication')) {
      mensaje = 'Token de MercadoPago inválido o expirado';
    } else if (error.message.includes('Invalid access_token')) {
      mensaje = 'Token de acceso inválido';
    }
    
    res.status(500).json({
      success: false,
      message: mensaje,
      error: error.message,
      status: 'Desconectado',
      token_valido: false
    });
  }
});

// GET /api/debug-premios - Para diagnóstico
app.get('/api/debug-premios', (req, res) => {
  db.all(
    `SELECT id, nombre, precio, stock, activo, creado 
     FROM premios 
     ORDER BY id DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT COUNT(*) as total FROM premios', (err, countRow) => {
        res.json({
          total_registros: countRow?.total || 0,
          premios: rows,
          mensaje: `Hay ${rows.length} premios en la base de datos`
        });
      });
    }
  );
});

// ============ MANEJO DE ERRORES ============

// Middleware para rutas no encontradas
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    metodo: req.method,
    timestamp: new Date().toISOString()
  });
});

// Middleware para errores generales
app.use((err, req, res, next) => {
  console.error('🔥 Error no manejado:', err.message);
  
  res.status(err.status || 500).json({
    error: 'Error interno del servidor',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// ============ INICIAR SERVIDOR ============
app.listen(PUERTO, () => {
  console.log(`🚀 SERVIDOR DE PRODUCCIÓN ACTIVO en ${DOMINIO}`);
  console.log(`💰 MERCADOPAGO: MODO PRODUCCIÓN`);
  console.log(`🔑 Token: ${MP_ACCESS_TOKEN.substring(0, 15)}...`);
  console.log(`\n🔧 Endpoints principales:`);
  console.log(`   📍 GET  ${DOMINIO}/api/premios           - Premios para frontend`);
  console.log(`   📍 GET  ${DOMINIO}/api/estadisticas      - Estadísticas dashboard`);
  console.log(`   📍 POST ${DOMINIO}/api/admin/premios     - Crear premio (admin)`);
  console.log(`   📍 POST ${DOMINIO}/api/crear-pago        - Crear pago real`);
  console.log(`\n👑 Panel Admin: ${DOMINIO}/admin?user=admin&pass=admin123`);
  console.log(`\n✅ Sistema COMPLETO listo para producción`);
});