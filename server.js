const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();



// ============ CONFIGURACIÓN MERCADOPAGO REAL ============
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY;

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 10000 }
});

// ============ CONFIGURACIÓN SERVIDOR ============
const DOMINIO = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
const PUERTO = process.env.PORT || 3000;



// ============ MIDDLEWARE ============
app.use(cors({
  origin: DOMINIO,
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
/* RUTA PRINCIPAL */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
      payment_id TEXT,
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


   // Tabla numeros de rifa (REAL)
db.run(`
  CREATE TABLE IF NOT EXISTS numeros_rifa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    premio_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    estado TEXT DEFAULT 'disponible',
    email TEXT,
    compra_id INTEGER,
    fecha_reserva TIMESTAMP,
    fecha_venta TIMESTAMP,
    UNIQUE(premio_id, numero)
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

  // Trigger para auto-crear números cuando se crea un premio (NUEVO)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS crear_numeros_premio 
    AFTER INSERT ON premios
    BEGIN
      INSERT INTO numeros_rifa (premio_id, numero)
      SELECT NEW.id, value
      FROM (
        WITH RECURSIVE numbers(n) AS (
          SELECT 1
          UNION ALL
          SELECT n+1 FROM numbers WHERE n < NEW.stock
        )
        SELECT n as value FROM numbers
      );
    END
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

// ============ RUTAS PARA NÚMEROS DE RIFA (NUEVO) ============

app.get('/api/numeros/:premioId', (req, res) => {
  const { premioId } = req.params;

  db.all(
    `SELECT numero, estado, email, fecha_reserva, fecha_venta
     FROM numeros_rifa
     WHERE premio_id = ?
     ORDER BY numero`,
    [premioId],
    (err, numeros) => {
      if (err) {
        return res.status(500).json({ error: 'Error números' });
      }

      res.json({
        success: true,
        numeros
      });
    }
  );
});
    
    // Obtener también información del premio
    db.get(
      'SELECT stock, vendidos FROM premios WHERE id = ?',
      [premioId],
      (err, premio) => {
        if (err) {
          console.error('Error obteniendo info premio:', err);
          return res.json({ numeros: rows });
        }
        
        const disponibles = premio ? premio.stock - premio.vendidos : rows.length;
        
        res.json({
          numeros: rows,
          premio: {
            stock: premio?.stock || 0,
            vendidos: premio?.vendidos || 0,
            disponibles: disponibles
          }
        });
      }
    );
  });
});

// POST /api/reservar-numeros - Reservar números temporalmente
app.post('/api/reservar-numeros', (req, res) => {
  const { premioId, numeros, email } = req.body;
  
  console.log(`📌 Reservando números:`, { premioId, numeros, email });
  
  if (!premioId || !numeros || !Array.isArray(numeros) || numeros.length === 0 || !email) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  
  db.serialize(() => {
    // 1. Verificar que todos los números estén disponibles
    const placeholders = numeros.map(() => '?').join(',');
    const query = `
      SELECT numero, estado 
      FROM numeros_rifa 
      WHERE premio_id = ? AND numero IN (${placeholders})
    `;
    
    db.all(query, [premioId, ...numeros], (err, rows) => {
      if (err) {
        console.error('❌ Error verificando números:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      
      // Verificar disponibilidad
      const noDisponibles = rows.filter(row => row.estado !== 'disponible');
      if (noDisponibles.length > 0) {
        console.log(`❌ Números no disponibles:`, noDisponibles);
        return res.status(400).json({
          error: 'Algunos números no están disponibles',
          numeros_no_disponibles: noDisponibles.map(n => n.numero)
        });
      }
      
      // 2. Reservar los números por 10 minutos
      const updateQuery = `
        UPDATE numeros_rifa 
        SET estado = 'reservado', 
            email = ?,
            fecha_reserva = CURRENT_TIMESTAMP
        WHERE premio_id = ? AND numero IN (${placeholders})
      `;
      
      db.run(updateQuery, [email, premioId, ...numeros], function(err) {
        if (err) {
          console.error('❌ Error reservando números:', err);
          return res.status(500).json({ error: 'Error al reservar números' });
        }
        
        console.log(`✅ Números reservados: ${numeros.join(',')}, cambios: ${this.changes}`);
        
        // 3. Programar liberación automática en 10 minutos
        setTimeout(() => {
          db.run(
            `UPDATE numeros_rifa 
             SET estado = 'disponible', email = NULL, fecha_reserva = NULL
             WHERE premio_id = ? AND numero IN (${placeholders}) AND estado = 'reservado'`,
            [premioId, ...numeros]
          );
          console.log(`🔄 Números ${numeros.join(',')} liberados automáticamente`);
        }, 10 * 60 * 1000); // 10 minutos
        
        res.json({
          success: true,
          message: `Números ${numeros.join(', ')} reservados por 10 minutos`,
          numeros_reservados: numeros,
          liberacion: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        });
      });
    });
  });
});

// POST /api/confirmar-numeros - Confirmar números después de pago exitoso
app.post('/api/confirmar-numeros', (req, res) => {
  const { premioId, numeros, compraId, email } = req.body;
  
  console.log(`✅ Confirmando números:`, { premioId, numeros, compraId, email });
  
  if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
    return res.status(400).json({ error: 'Números inválidos' });
  }
  
  const placeholders = numeros.map(() => '?').join(',');
  
  db.run(
    `UPDATE numeros_rifa 
     SET estado = 'vendido', 
         compra_id = ?,
         email = ?,
         fecha_venta = CURRENT_TIMESTAMP
     WHERE premio_id = ? AND numero IN (${placeholders})`,
    [compraId, email, premioId, ...numeros],
    function(err) {
      if (err) {
        console.error('❌ Error confirmando números:', err);
        return res.status(500).json({ error: 'Error interno' });
      }
      
      console.log(`✅ Números ${numeros.join(',')} confirmados para compra ${compraId}, cambios: ${this.changes}`);
      res.json({
        success: true,
        numeros_confirmados: numeros,
        cambios: this.changes
      });
    }
  );
});

// ============ RUTA DE PAGO CON NÚMEROS (MODIFICADA) ============

// POST /api/crear-pago - Crear pago REAL con MercadoPago
app.post('/api/crear-pago', async (req, res) => {
  try {
    const { premioId, email, cantidad, nombre, telefono, numeros } = req.body;

    console.log('🔄 Creando pago con números:', { premioId, email, cantidad, numeros });

    // Validaciones
    if (!premioId || !email || !cantidad) {
      return res.status(400).json({ 
        error: 'Datos incompletos',
        requeridos: ['premioId', 'email', 'cantidad']
      });
    }

    // Validar que cantidad coincida con números seleccionados
    if (numeros && Array.isArray(numeros)) {
      if (numeros.length !== parseInt(cantidad)) {
        return res.status(400).json({ 
          error: 'La cantidad de números no coincide',
          cantidad_seleccionada: numeros.length,
          cantidad_solicitada: cantidad
        });
      }
      
      // Verificar que los números sean únicos
      const numerosUnicos = [...new Set(numeros)];
      if (numerosUnicos.length !== numeros.length) {
        return res.status(400).json({ 
          error: 'Hay números duplicados',
          numeros: numeros
        });
      }
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
    
    // Obtener el dominio dinámicamente
    const protocol = req.protocol;
    const host = req.get('host');
    const dominio = `${protocol}://${host}`;
    
    // Si hay números específicos, incluirlos en la descripción
    const descripcionExtendida = numeros && numeros.length > 0
      ? `${premio.descripcion || 'Participación en rifa'} - Números: ${numeros.join(', ')}`
      : premio.descripcion || 'Participación en rifa';
    
    const preferenceBody = {
      items: [
        {
          id: premio.id.toString(),
          title: `Rifa: ${premio.nombre}`,
          description: descripcionExtendida.substring(0, 250),
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
        installments: 1,
        default_installments: 1
      },
      back_urls: {
        success: `${dominio}/success`,
        failure: `${dominio}/error`,
        pending: `${dominio}/pending`
      },
      notification_url: `${dominio}/api/webhook`,
      statement_descriptor: 'RIFAS*TUEMPRESA',
      external_reference: `rifa_${premio.id}_${Date.now()}`,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 3600000).toISOString(),
      metadata: {
        premio_id: premio.id,
        premio_nombre: premio.nombre,
        cantidad: cantidad,
        numeros: numeros || [],
        email: email,
        sistema: 'rifas_produccion'
      }
    };

    console.log('📤 Enviando a MercadoPago con números:', {
      numeros: numeros || 'aleatorios'
    });

    const result = await preference.create({ body: preferenceBody });
    
    console.log('✅ Respuesta MercadoPago:', result.id);

    // 4. Registrar compra en nuestra BD con números
    const compraId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO compras 
         (premio_id, email, cantidad, total, preference_id, status, datos_pago) 
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [
          premioId, 
          email, 
          cantidad, 
          total, 
          result.id,
          JSON.stringify({
            numeros_seleccionados: numeros || [],
            metadata: preferenceBody.metadata
          })
        ],
        function(err) {
          if (err) {
            console.error('❌ Error SQL en compra:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });

    console.log(`✅ Compra registrada: ID=${compraId}`);

    // 5. Si hay números específicos, reservarlos para pago
    if (numeros && numeros.length > 0) {
      try {
        await new Promise((resolve, reject) => {
          const placeholders = numeros.map(() => '?').join(',');
          db.run(
            `UPDATE numeros_rifa 
             SET estado = 'reservado_pago', 
                 email = ?,
                 fecha_reserva = CURRENT_TIMESTAMP
             WHERE premio_id = ? AND numero IN (${placeholders})`,
            [email, premioId, ...numeros],
            function(err) {
              if (err) {
                console.error('❌ Error reservando números:', err);
                reject(err);
              } else {
                console.log(`🔢 Números reservados para pago: ${numeros.join(',')}, cambios: ${this.changes}`);
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error('Error reservando números:', error);
      }
    }

    // 6. Devolver datos al frontend
    res.json({
      success: true,
      preference_id: result.id,
      init_point: result.init_point,
      compra_id: compraId,
      total: total,
      modo: 'produccion',
      public_key: MP_PUBLIC_KEY,
      numeros_seleccionados: numeros || []
    });

  } catch (error) {
    console.error('❌ Error en /api/crear-pago:', error);
    
    res.status(500).json({ 
      error: 'Error al crear el pago',
      mensaje: error.message || 'Error desconocido'
    });
  }
});

// ============ WEBHOOK MERCADOPAGO REAL (MODIFICADO) ============

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
                 payment_id = ?,
                 fecha_actualizacion = CURRENT_TIMESTAMP,
                 datos_pago = COALESCE(?, datos_pago),
                 notificado = 1
             WHERE id = ?`,
            [
              mpPayment.status,
              mpPayment.status_detail,
              mpPayment.id,
              JSON.stringify(mpPayment),
              compra.id
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // 4. Si el pago fue aprobado, actualizar stock, vendidos y números
        if (mpPayment.status === 'approved') {
          // Asignar números vendidos

          console.log(`✅ Pago aprobado: ${paymentId} para compra ${compra.id}`);
          
          // Obtener datos de la compra
          let datosCompra = {};
          try {
            datosCompra = compra.datos_pago ? JSON.parse(compra.datos_pago) : {};
          } catch (e) {
            console.error('Error parseando datos_pago:', e);
          }
          
          const numerosSeleccionados = datosCompra.numeros_seleccionados || [];
          
          db.serialize(() => {
            // Actualizar stock y vendidos del premio
            db.run(
              'UPDATE premios SET stock = stock - ?, vendidos = vendidos + ? WHERE id = ?',
              [compra.cantidad, compra.cantidad, compra.premio_id],
              (err) => {
                if (err) console.error('❌ Error actualizando stock:', err);
                else console.log(`📈 Stock actualizado para premio ${compra.premio_id}`);
              }
            );
            
            // Procesar números
            if (numerosSeleccionados.length > 0) {
              // Confirmar números específicos seleccionados
              const placeholders = numerosSeleccionados.map(() => '?').join(',');
              db.run(
                `UPDATE numeros_rifa 
                 SET estado = 'vendido', 
                     compra_id = ?,
                     fecha_venta = CURRENT_TIMESTAMP
                 WHERE premio_id = ? AND numero IN (${placeholders})`,
                [compra.id, compra.premio_id, ...numerosSeleccionados],
                (err) => {
                  if (err) console.error('❌ Error confirmando números:', err);
                  else console.log(`✅ Números ${numerosSeleccionados.join(',')} marcados como vendidos`);
                }
              );
            } else {
              // Asignar números aleatorios disponibles
              db.all(
                `SELECT numero FROM numeros_rifa 
                 WHERE premio_id = ? AND estado = 'disponible' 
                 LIMIT ?`,
                [compra.premio_id, compra.cantidad],
                (err, disponibles) => {
                  if (!err && disponibles.length >= compra.cantidad) {
                    const numerosAleatorios = disponibles.map(d => d.numero);
                    const placeholders = numerosAleatorios.map(() => '?').join(',');
                    
                    db.run(
                      `UPDATE numeros_rifa 
                       SET estado = 'vendido', 
                           compra_id = ?,
                           email = ?,
                           fecha_venta = CURRENT_TIMESTAMP
                       WHERE premio_id = ? AND numero IN (${placeholders})`,
                      [compra.id, compra.email, compra.premio_id, ...numerosAleatorios],
                      (err) => {
                        if (err) console.error('❌ Error asignando números aleatorios:', err);
                        else console.log(`🎲 Números aleatorios asignados: ${numerosAleatorios.join(',')}`);
                      }
                    );
                    
                    // Actualizar datos_pago con números asignados
                    db.run(
                      `UPDATE compras SET datos_pago = json_patch(?, ?) WHERE id = ?`,
                      [
                        compra.datos_pago || '{}',
                        JSON.stringify({ numeros_asignados: numerosAleatorios }),
                        compra.id
                      ]
                    );
                  } else {
                    console.log(`⚠️ No hay suficientes números disponibles para asignar aleatoriamente`);
                  }
                }
              );
            }
          });

        } else if (mpPayment.status === 'rejected' || mpPayment.status === 'cancelled') {
          console.log(`❌ Pago rechazado: ${paymentId}`);
          
          // Liberar números reservados
          let datosCompra = {};
          try {
            datosCompra = compra.datos_pago ? JSON.parse(compra.datos_pago) : {};
          } catch (e) {
            console.error('Error parseando datos_pago:', e);
          }
          
          const numerosSeleccionados = datosCompra.numeros_seleccionados || [];
          if (numerosSeleccionados.length > 0) {
            const placeholders = numerosSeleccionados.map(() => '?').join(',');
            db.run(
              `UPDATE numeros_rifa 
               SET estado = 'disponible', 
                   email = NULL,
                   fecha_reserva = NULL
               WHERE premio_id = ? AND numero IN (${placeholders}) AND estado = 'reservado_pago'`,
              [compra.premio_id, ...numerosSeleccionados],
              (err) => {
                if (err) console.error('❌ Error liberando números:', err);
                else console.log(`🔄 Números ${numerosSeleccionados.join(',')} liberados por pago rechazado`);
              }
            );
          }
        }
      } else {
        console.warn(`⚠️ Pago no encontrado en BD: ${paymentId}`);
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

// ============ RUTAS RESTANTES (IGUAL QUE ANTES) ============

// GET /success - Página de éxito
app.get('/success', (req, res) => {
  const { payment_id, preference_id, collection_id, external_reference } = req.query;
  const paymentId = payment_id || preference_id || collection_id;
  
  console.log('✅ Usuario llegó a /success con:', { payment_id, preference_id, collection_id });
  
  if (paymentId) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>¡Pago Exitoso! - Sistema de Rifas</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <meta http-equiv="refresh" content="5;url=/">
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
          .info-box {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            font-family: monospace;
            font-size: 14px;
            word-break: break-all;
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
          
          ${paymentId ? `
            <div class="info-box">
              <strong>ID de Transacción:</strong><br>
              ${paymentId.substring(0, 15)}...
            </div>
          ` : ''}
          
          <p>Recibirás un correo con los detalles de tu compra.</p>
          <p style="font-size: 0.9rem; color: #888; margin-top: 30px;">
            <i class="fas fa-clock"></i>
            Serás redirigido al inicio en 5 segundos...
          </p>
          
          <a href="/" class="btn">
            <i class="fas fa-home"></i> Volver al Inicio Ahora
          </a>
        </div>
      </body>
      </html>
    `);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
  }
});

// GET /pending - Página de pendiente
app.get('/pending', (req, res) => {
  const { payment_id, preference_id } = req.query;
  
  console.log('⏳ Usuario llegó a /pending con:', { payment_id, preference_id });
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Pago Pendiente - Sistema de Rifas</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .pending-box {
          background: white;
          border-radius: 20px;
          padding: 50px;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
          max-width: 600px;
          width: 100%;
        }
        .pending-icon {
          font-size: 5rem;
          color: #FF9800;
          margin-bottom: 20px;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        h1 { color: #2D3047; margin-bottom: 20px; }
        p { color: #666; margin-bottom: 15px; line-height: 1.6; }
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
      <div class="pending-box">
        <div class="pending-icon">
          <i class="fas fa-clock"></i>
        </div>
        <h1>Pago Pendiente ⏳</h1>
        <p>Tu pago está siendo procesado.</p>
        <p>Te notificaremos por email cuando se complete la transacción.</p>
        ${payment_id ? `
          <p style="font-size: 0.9rem; color: #888; margin-top: 20px;">
            <i class="fas fa-info-circle"></i>
            ID de pago: ${payment_id.substring(0, 20)}...
          </p>
        ` : ''}
        <a href="/" class="btn">
          <i class="fas fa-home"></i> Volver al Inicio
        </a>
      </div>
    </body>
    </html>
  `);
});

// GET /error - Página de error
app.get('/error', (req, res) => {
  const { payment_id, preference_id } = req.query;
  
  console.log('❌ Usuario llegó a /error con:', { payment_id, preference_id });
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Error en Pago - Sistema de Rifas</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .error-box {
          background: white;
          border-radius: 20px;
          padding: 50px;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
          max-width: 600px;
          width: 100%;
        }
        .error-icon {
          font-size: 5rem;
          color: #f44336;
          margin-bottom: 20px;
          animation: shake 0.5s;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }
        h1 { color: #2D3047; margin-bottom: 20px; }
        p { color: #666; margin-bottom: 15px; line-height: 1.6; }
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
      <div class="error-box">
        <div class="error-icon">
          <i class="fas fa-times-circle"></i>
        </div>
        <h1>Error en el Pago ❌</h1>
        <p>Hubo un problema al procesar tu pago.</p>
        <p>Por favor, intenta nuevamente o contacta con soporte.</p>
        <a href="/" class="btn">
          <i class="fas fa-home"></i> Volver al Inicio
        </a>
        <a href="#" onclick="window.history.back()" class="btn" style="background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);">
          <i class="fas fa-redo"></i> Reintentar Pago
        </a>
      </div>
    </body>
    </html>
  `);
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

// ============ DASHBOARD ADMIN COMPLETO (IGUAL) ============

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
        
        /* Estilos para números de rifa (NUEVO) */
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
          <div id="dashboard" class="seccion">
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
                <p><strong>URL del Sitio:</strong> <a href="/" target="_blank">${DOMINIO}</a></p>
                <p><strong>MercadoPago:</strong> <span id="mp-status" style="color: #4CAF50;">Conectado</span></p>
                <p><strong>Base de Datos:</strong> rifas_produccion.db</p>
                <p><strong>Modo:</strong> Producción</p>
                <p><strong>Números de Rifa:</strong> <span style="color: #4CAF50;">Activado</span></p>
              </div>
            </div>
          </div>
          
          <!-- 2. AGREGAR PREMIO -->
          <div id="agregar-premio" class="seccion" style="display: none;">
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
          <div id="lista-premios" class="seccion" style="display: none;">
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
          <div id="ver-compras" class="seccion" style="display: none;">
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
          
          <!-- 5. VER NÚMEROS (NUEVA SECCIÓN) -->
          <div id="ver-numeros" class="seccion" style="display: none;">
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
        
        // Mostrar/ocultar secciones
        function mostrarSeccion(seccionId) {
          // Ocultar todas las secciones
          document.querySelectorAll('.seccion').forEach(sec => {
            sec.style.display = 'none';
          });
          
          // Mostrar la seleccionada
          document.getElementById(seccionId).style.display = 'block';
          
          // Actualizar título
          const titulos = {
            'dashboard': 'Dashboard',
            'agregar-premio': 'Agregar Premio',
            'lista-premios': 'Lista de Premios',
            'ver-compras': 'Ver Compras',
            'ver-numeros': 'Ver Números'
          };
          document.getElementById('titulo-seccion').textContent = titulos[seccionId] || 'Dashboard';
          
          // Actualizar menu activo
          document.querySelectorAll('.sidebar-menu li').forEach(li => {
            li.classList.remove('active');
          });
          event.target.closest('li').classList.add('active');
          
          // Cargar datos si es necesario
          if (seccionId === 'dashboard') {
            actualizarEstadisticas();
          } else if (seccionId === 'lista-premios') {
            cargarPremiosAdmin();
          } else if (seccionId === 'ver-compras') {
            cargarCompras();
          } else if (seccionId === 'ver-numeros') {
            cargarSelectPremiosNumeros();
          }
        }
        
        // Inicializar íconos
        function inicializarIconos() {
          const grid = document.getElementById('iconos-grid');
          if (!grid) return;
          
          grid.innerHTML = '';
          
          iconosDisponibles.forEach(icono => {
            const div = document.createElement('div');
            div.className = 'icon-option';
            div.innerHTML = \`<i class="fas \${icono} fa-2x"></i>\`;
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
          alert.className = \`alert alert-\${tipo}\`;
          alert.innerHTML = \`
            <i class="fas \${tipo === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
            \${mensaje}
          \`;
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
            const response = await fetch(\`\${API_URL}/api/estadisticas\`);
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
            const response = await fetch(\`\${API_URL}/api/admin/premios\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(premio)
            });
            
            const data = await response.json();
            
            if (response.ok) {
              mostrarAlerta(\`Premio "\${premio.nombre}" agregado exitosamente! ID: \${data.id}\`, 'success');
              
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
              mostrarAlerta(\`Error: \${data.error || 'No se pudo agregar el premio'}\`, 'error');
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
            const response = await fetch(\`\${API_URL}/api/admin/premios/todos\`);
            premiosAdmin = await response.json();
            
            const tbody = document.querySelector('#tabla-premios tbody');
            const busqueda = document.getElementById('buscar-premio')?.value.toLowerCase() || '';
            
            tbody.innerHTML = '';
            
            premiosAdmin
              .filter(premio => premio.nombre.toLowerCase().includes(busqueda))
              .forEach(premio => {
                const tr = document.createElement('tr');
                tr.innerHTML = \`
                  <td>\${premio.id}</td>
                  <td><i class="fas \${premio.icono || 'fa-gift'} fa-2x"></i></td>
                  <td>
                    <strong>\${premio.nombre}</strong><br>
                    <small style="color: #666;">\${premio.descripcion || 'Sin descripción'}</small>
                  </td>
                  <td>\$\${premio.precio}</td>
                  <td>
                    <span class="badge \${premio.stock > 20 ? 'badge-success' : premio.stock > 0 ? 'badge-warning' : 'badge-danger'}">
                      \${premio.stock}
                    </span>
                  </td>
                  <td>\${premio.vendidos || 0}</td>
                  <td>
                    <span class="badge \${premio.activo ? 'badge-success' : 'badge-danger'}">
                      \${premio.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div class="action-buttons">
                      <button class="action-btn edit-btn" onclick="editarPremio(\${premio.id})">
                        <i class="fas fa-edit"></i>
                      </button>
                      <button class="action-btn delete-btn" onclick="eliminarPremio(\${premio.id})">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                \`;
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
              const response = await fetch(\`\${API_URL}/api/admin/premios/\${id}\`, {
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
                mostrarAlerta(\`Error: \${data.error}\`, 'error');
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
            const response = await fetch(\`\${API_URL}/api/admin/premios/\${id}\`, {
              method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (response.ok) {
              mostrarAlerta('Premio eliminado exitosamente', 'success');
              cargarPremiosAdmin();
              actualizarEstadisticas();
            } else {
              mostrarAlerta(\`Error: \${data.error}\`, 'error');
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
            const response = await fetch(\`\${API_URL}/api/admin/compras\`);
            const compras = await response.json();
            
            const tbody = document.querySelector('#tabla-compras tbody');
            tbody.innerHTML = '';
            
            compras.forEach(compra => {
              const tr = document.createElement('tr');
              tr.innerHTML = \`
                <td>\${compra.id}</td>
                <td>\${new Date(compra.fecha_creacion).toLocaleDateString()}</td>
                <td>\${compra.email}</td>
                <td>\${compra.premio_nombre || 'Premio ' + compra.premio_id}</td>
                <td>\${compra.cantidad}</td>
                <td>\$\${compra.total}</td>
                <td>
                  <span class="badge \${compra.status === 'approved' ? 'badge-success' : 
                                       compra.status === 'pending' ? 'badge-warning' : 
                                       'badge-danger'}">
                    \${compra.status || 'pending'}
                  </span>
                </td>
              \`;
              tbody.appendChild(tr);
            });
            
          } catch (error) {
            console.error('Error cargando compras:', error);
            mostrarAlerta('Error al cargar las compras', 'error');
          }
        }
        
        // ============ NÚMEROS DE RIFA (NUEVO) ============
        
        // Cargar select de premios para números
        async function cargarSelectPremiosNumeros() {
          try {
            const response = await fetch(\`\${API_URL}/api/admin/premios/todos\`);
            const premios = await response.json();
            
            const select = document.getElementById('select-premio-numeros');
            select.innerHTML = '<option value="">-- Selecciona un premio --</option>';
            
            premios.forEach(premio => {
              const option = document.createElement('option');
              option.value = premio.id;
              option.textContent = \`\${premio.id} - \${premio.nombre} (Stock: \${premio.stock}, Vendidos: \${premio.vendidos || 0})\`;
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
            const response = await fetch(\`\${API_URL}/api/numeros/\${premioId}?estado=all\`);
            const data = await response.json();
            
            const container = document.getElementById('numeros-premio-container');
            
            if (!data.numeros || data.numeros.length === 0) {
              container.innerHTML = \`
                <div style="text-align: center; padding: 40px; color: #666;">
                  <i class="fas fa-exclamation-circle fa-3x" style="margin-bottom: 20px;"></i>
                  <h3>No hay números registrados para este premio</h3>
                  <p>Los números se crean automáticamente al agregar el premio.</p>
                </div>
              \`;
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
            
            let html = \`
              <div style="margin-bottom: 20px;">
                <h3>\${premioNombre}</h3>
                <div class="stats-grid" style="margin-top: 15px;">
                  <div class="stat-card">
                    <div class="stat-number" style="color: #4CAF50;">\${porEstado.disponible.length}</div>
                    <div class="stat-label">Disponibles</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-number" style="color: #FF9800;">\${porEstado.reservado.length}</div>
                    <div class="stat-label">Reservados</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-number" style="color: #f44336;">\${porEstado.vendido.length}</div>
                    <div class="stat-label">Vendidos</div>
                  </div>
                </div>
              </div>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">
                <h4>Todos los números (\${data.numeros.length})</h4>
                <div class="numeros-grid-admin">
            \`;
            
            // Mostrar todos los números con colores según estado
            data.numeros.sort((a, b) => a.numero - b.numero).forEach(numero => {
              let clase = 'numero-badge ';
              let titulo = \`Número \${numero.numero}\`;
              
              if (numero.estado === 'disponible') {
                clase += 'numero-disponible';
                titulo += ' - Disponible';
              } else if (numero.estado === 'reservado' || numero.estado === 'reservado_pago') {
                clase += 'numero-reservado';
                titulo += \` - Reservado\`;
                if (numero.email) {
                  titulo += \` por: \${numero.email}\`;
                }
                if (numero.fecha_reserva) {
                  titulo += \` (\${new Date(numero.fecha_reserva).toLocaleString()})\`;
                }
              } else if (numero.estado === 'vendido') {
                clase += 'numero-vendido';
                titulo += \` - Vendido\`;
                if (numero.email) {
                  titulo += \` a: \${numero.email}\`;
                }
                if (numero.fecha_venta) {
                  titulo += \` (\${new Date(numero.fecha_venta).toLocaleString()})\`;
                }
              }
              
              html += \`
                <div class="\${clase}" title="\${titulo}">
                  \${numero.numero}
                </div>
              \`;
            });
            
            html += \`
                </div>
              </div>
              
              <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
                <div style="display: flex; align-items: center; gap: 5px;">
                  <div style="width: 15px; height: 15px; background: #d4edda; border: 1px solid #c3e6cb;"></div>
                  <span>Disponible</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                  <div style="width: 15px; height: 15px; background: #fff3cd; border: 1px solid #ffeaa7;"></div>
                  <span>Reservado</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                  <div style="width: 15px; height: 15px; background: #f8d7da; border: 1px solid #f5c6cb;"></div>
                  <span>Vendido</span>
                </div>
              </div>
            \`;
            
            container.innerHTML = html;
            
          } catch (error) {
            console.error('Error cargando números:', error);
            document.getElementById('numeros-premio-container').innerHTML = \`
              <div class="alert alert-error">
                <i class="fas fa-exclamation-circle"></i>
                Error al cargar los números: \${error.message}
              </div>
            \`;
          }
        }
        
        // Resetear demo
        async function resetearDemo() {
          if (!confirm('¿Resetear todos los datos de prueba? Esto eliminará todas las compras y reseteará el stock.')) {
            return;
          }
          
          try {
            const response = await fetch(\`\${API_URL}/api/reset-demo\`, {
              method: 'POST'
            });
            
            const data = await response.json();
            
            if (response.ok) {
              mostrarAlerta('Datos de prueba reseteados exitosamente', 'success');
              actualizarEstadisticas();
              cargarPremiosAdmin();
              cargarCompras();
            } else {
              mostrarAlerta(\`Error: \${data.error}\`, 'error');
            }
            
          } catch (error) {
            console.error('Error:', error);
            mostrarAlerta('Error de conexión', 'error');
          }
        }
        
        // ============ INICIALIZACIÓN ============
        
        document.addEventListener('DOMContentLoaded', function() {
          // Inicializar íconos
          inicializarIconos();
          
          // Cargar estadísticas iniciales
          actualizarEstadisticas();
          
          // Agregar búsqueda en tiempo real
          const buscarInput = document.getElementById('buscar-premio');
          if (buscarInput) {
            buscarInput.addEventListener('input', cargarPremiosAdmin);
          }
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
      // Crear números reales para el premio
for (let i = 1; i <= parseInt(stock); i++) {
  db.run(
    `INSERT INTO numeros (premio_id, numero) VALUES (?, ?)`,
    [nuevoId, i]
  );
}
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
      
      // Eliminar todos los números
      db.run('DELETE FROM numeros_rifa', (err) => {
        if (err) {
          console.error('Error eliminando números:', err);
          return res.status(500).json({ error: 'Error interno' });
        }
        
        // Resetear stock de todos los premios a 100
        db.run('UPDATE premios SET stock = 100, vendidos = 0', (err) => {
          if (err) {
            console.error('Error reseteando stock:', err);
            return res.status(500).json({ error: 'Error interno' });
          }
          
          // Volver a crear números para premios existentes
          db.all('SELECT id, stock FROM premios', (err, premios) => {
            if (!err && premios) {
              premios.forEach(premio => {
                // Crear números para este premio
                for (let i = 1; i <= premio.stock; i++) {
                  db.run(
                    'INSERT INTO numeros_rifa (premio_id, numero) VALUES (?, ?)',
                    [premio.id, i]
                  );
                }
              });
            }
            
            res.json({
              success: true,
              message: 'Datos de prueba reseteados correctamente',
              compras_eliminadas: 'Todas',
              numeros_eliminados: 'Todos',
              stock_reseteado: 'Todos a 100 unidades',
              numeros_recreados: 'Sí'
            });
          });
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
      
      // 3. Estadísticas de números (NUEVO)
      db.get(`
        SELECT 
          COUNT(*) as total_numeros,
          SUM(CASE WHEN estado = 'disponible' THEN 1 ELSE 0 END) as numeros_disponibles,
          SUM(CASE WHEN estado = 'vendido' THEN 1 ELSE 0 END) as numeros_vendidos
        FROM numeros_rifa
      `, (err, row) => {
        if (!err) {
          estadisticas.numeros = {
            total: row.total_numeros || 0,
            disponibles: row.numeros_disponibles || 0,
            vendidos: row.numeros_vendidos || 0
          };
        }
        
        // 4. Últimas compras
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
        
        db.get('SELECT COUNT(*) as total FROM numeros_rifa', (err, numerosRow) => {
          if (!err) sistemaInfo.numeros_rifa = numerosRow.total;
          
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
});

// GET /api/debug-numeros/:premioId - Ver números detallados de un premio
app.get('/api/debug-numeros/:premioId', (req, res) => {
  const { premioId } = req.params;
  
  db.all(`
    SELECT nr.*, p.nombre as premio_nombre, c.email as comprador_email
    FROM numeros_rifa nr
    LEFT JOIN premios p ON nr.premio_id = p.id
    LEFT JOIN compras c ON nr.compra_id = c.id
    WHERE nr.premio_id = ?
    ORDER BY nr.numero ASC
  `, [premioId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Agrupar por estado
    const porEstado = {
      disponible: rows.filter(r => r.estado === 'disponible'),
      reservado: rows.filter(r => r.estado === 'reservado' || r.estado === 'reservado_pago'),
      vendido: rows.filter(r => r.estado === 'vendido')
    };
    
    res.json({
      premio_id: premioId,
      total_numeros: rows.length,
      por_estado: {
        disponible: porEstado.disponible.length,
        reservado: porEstado.reservado.length,
        vendido: porEstado.vendido.length
      },
      numeros: rows,
      detalles: porEstado
    });
  });
});






// ============ MANEJO DE ERRORES ============
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path
  });
});

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
  console.log(`🚀 SERVIDOR ACTIVO en puerto ${PUERTO}`);
  console.log(`💰 MERCADOPAGO: MODO PRODUCCIÓN`);
  console.log(`🔢 SISTEMA DE NÚMEROS: ACTIVADO`);
  console.log(`🔑 Token: ${MP_ACCESS_TOKEN.substring(0, 15)}...`);
  console.log(`\n🔧 Endpoints principales:`);
  console.log(`   📍 GET  ${DOMINIO}/                    - Frontend principal`);
  console.log(`   📍 GET  ${DOMINIO}/api/premios        - Premios disponibles`);
  console.log(`   📍 GET  ${DOMINIO}/api/numeros/:id    - Números de premio`);
  console.log(`   📍 POST ${DOMINIO}/api/crear-pago     - Crear pago con números`);
  console.log(`   📍 GET  ${DOMINIO}/api/estadisticas   - Estadísticas`);
  console.log(`\n👑 Panel Admin: ${DOMINIO}/admin?user=admin&pass=admin123`);
  console.log(`\n✅ Sistema COMPLETO con números listo para producción`);
});

