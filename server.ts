import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_PATH = path.join(DATA_DIR, 'google_sheets_config.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const REPORTS_PATH = path.join(DATA_DIR, 'reports.json');
const SUBSCRIPTIONS_PATH = path.join(DATA_DIR, 'subscriptions.json');

// Ensure database files exist
if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify([], null, 2));
if (!fs.existsSync(REPORTS_PATH)) fs.writeFileSync(REPORTS_PATH, JSON.stringify([], null, 2));
if (!fs.existsSync(SUBSCRIPTIONS_PATH)) fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify([], null, 2));

import webPush from 'web-push';

const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid-keys.json');
let vapidKeys: { publicKey: string, privateKey: string };

if (fs.existsSync(VAPID_KEYS_PATH)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
} else {
  vapidKeys = webPush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
}

webPush.setVapidDetails(
  'mailto:nexuswebstudio2026@gmail.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

interface ConfigType {
  clientEmail: string;
  privateKey: string;
  sheetId: string;
}

// Get Saved Config Helper
function getSheetsConfig(): ConfigType | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(content);
      if (config.clientEmail && config.privateKey && config.sheetId) {
        return config;
      }
    }
  } catch (e) {
    console.error('Error reading configuration file', e);
  }

  // Fallback to Env Vars
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID) {
    return {
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY,
      sheetId: process.env.GOOGLE_SHEET_ID
    };
  }

  return null;
}

// Google Sheets Client Initializer
function getSheetsClient(config: ConfigType) {
  const auth = new (google.auth.JWT as any)(
    config.clientEmail,
    undefined,
    config.privateKey.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

// Helper to append a row to Google Sheets
async function appendToSheet(sheetName: string, rowValues: any[]) {
  const config = getSheetsConfig();
  if (!config) return false;

  try {
    const sheets = getSheetsClient(config);
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowValues],
      },
    });
    return true;
  } catch (error) {
    console.error(`Error appending to Google Sheet ${sheetName}:`, error);
    return false;
  }
}

// Helper to read rows from Google Sheets
async function readSheetValues(sheetName: string) {
  const config = getSheetsConfig();
  if (!config) return null;

  try {
    const sheets = getSheetsClient(config);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A:Z`,
    });
    return response.data.values || [];
  } catch (error) {
    console.error(`Error reading Google Sheet ${sheetName}:`, error);
    return null;
  }
}

// Helper to update a row or replace the entire sheet with synchronized data
async function syncWholeSheet(sheetName: string, headers: string[], rows: any[][]) {
  const config = getSheetsConfig();
  if (!config) return false;

  try {
    const sheets = getSheetsClient(config);
    
    // Clear existing values
    await sheets.spreadsheets.values.clear({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A:Z`,
    });

    // Write headers + data
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers, ...rows],
      },
    });
    return true;
  } catch (error) {
    console.error(`Error synchronizing Google Sheet ${sheetName}:`, error);
    return false;
  }
}

// Ensure proper Google Sheets Tabs and headers exist
async function ensureSheetStructure() {
  const config = getSheetsConfig();
  if (!config) return;

  try {
    const sheets = getSheetsClient(config);
    
    // Try to read standard spreadsheets metadata to see if sheets exist
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: config.sheetId,
    });
    
    const existingTitles = metadata.data.sheets?.map(s => s.properties?.title) || [];
    
    const requiredSheets = [
      {
        title: 'Usuarios',
        headers: ['ID', 'Fecha de Registro', 'Nombre', 'Email', 'Nombre de Usuario', 'Puntos de Confianza']
      },
      {
        title: 'Reportes',
        headers: ['ID', 'Fecha de Reporte', 'Usuario Creador', 'Latitud', 'Longitud', 'Tipo de Reten', 'Descripcion', 'Ubicacion Aproximada', 'Estado', 'Votos Si', 'Votos No']
      }
    ];

    for (const req of requiredSheets) {
      if (!existingTitles.includes(req.title)) {
        // Add Sheet tab
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: config.sheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: req.title }
                }
              }
            ]
          }
        });
        
        // Add Headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.sheetId,
          range: `${req.title}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [req.headers]
          }
        });
      }
    }
  } catch (e) {
    console.error('Failed to initialize Google Sheets template structure:', e);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Try to set up sheets structure on boot if configured
  ensureSheetStructure();

  // 1. Config Endpoints
  app.get('/api/config', (req, res) => {
    let clientEmail = '';
    let sheetId = '';
    let hasPrivateKey = false;
    let isConfigured = false;

    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(content);
        clientEmail = config.clientEmail || '';
        sheetId = config.sheetId || '';
        hasPrivateKey = !!config.privateKey;
        isConfigured = !!(config.clientEmail && config.privateKey && config.sheetId);
      }
    } catch (e) {
      console.error('Error parsing config file on GET', e);
    }

    res.json({
      isConfigured,
      clientEmail,
      sheetId,
      hasPrivateKey,
      sheetLink: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : ''
    });
  });

  app.post('/api/config', async (req, res) => {
    const { clientEmail, privateKey, sheetId } = req.body;
    
    if (!clientEmail || !privateKey || !sheetId) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    try {
      let finalPrivateKey = privateKey;
      
      if (privateKey === 'Preconfigurada_No_Es_Necesario_Modificar') {
        // Read existing private key from config file
        if (fs.existsSync(CONFIG_PATH)) {
          const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
          const existing = JSON.parse(content);
          finalPrivateKey = existing.privateKey;
        } else {
          return res.status(400).json({ error: 'La llave privada preconfigurada no fue encontrada. Por favor ingresa una llave válida.' });
        }
      }

      const formattedPrivateKey = finalPrivateKey.includes('-----BEGIN PRIVATE KEY-----') 
        ? finalPrivateKey 
        : `-----BEGIN PRIVATE KEY-----\n${finalPrivateKey}\n-----END PRIVATE KEY-----`;

      const newConfig: ConfigType = {
        clientEmail,
        privateKey: formattedPrivateKey,
        sheetId
      };

      // Test credentials before saving
      const sheets = getSheetsClient(newConfig);
      await sheets.spreadsheets.get({ spreadsheetId: sheetId });

      // Save Config
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
      
      // Ensure Sheets Structure
      await ensureSheetStructure();

      // Trigger user & reports synchronization from local files to sheet
      const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
      const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));

      await syncWholeSheet(
        'Usuarios', 
        ['ID', 'Fecha de Registro', 'Nombre', 'Email', 'Nombre de Usuario', 'Puntos de Confianza'],
        users.map((u: any) => [u.id, u.registeredAt, u.name, u.email, u.username, u.trustPoints || 0])
      );

      await syncWholeSheet(
        'Reportes',
        ['ID', 'Fecha de Reporte', 'Usuario Creador', 'Latitud', 'Longitud', 'Tipo de Reten', 'Descripcion', 'Ubicacion Aproximada', 'Estado', 'Votos Si', 'Votos No'],
        reports.map((r: any) => [r.id, r.reportedAt, r.creator, r.lat, r.lng, r.type, r.description, r.locationName, r.status, r.votesUp || 0, r.votesDown || 0])
      );

      res.json({ success: true, message: 'Configuración guardada y sincronizada correctamente.' });
    } catch (error: any) {
      console.error('Error testing/saving sheets config:', error);
      res.status(400).json({ 
        error: 'No se pudo conectar a Google Sheets. Verifica que hayas compartido la hoja con el correo de la Cuenta de Servicio con permisos de Editor y que el ID de la hoja sea correcto.',
        details: error.message 
      });
    }
  });

  app.post('/api/config/test', async (req, res) => {
    const { clientEmail, privateKey, sheetId } = req.body;
    try {
      let finalPrivateKey = privateKey;
      if (privateKey === 'Preconfigurada_No_Es_Necesario_Modificar') {
        if (fs.existsSync(CONFIG_PATH)) {
          const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
          const existing = JSON.parse(content);
          finalPrivateKey = existing.privateKey;
        }
      }
      const sheets = getSheetsClient({ clientEmail, privateKey: finalPrivateKey, sheetId });
      await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // 2. Auth Endpoints
  app.post('/api/register', async (req, res) => {
    const { name, email, username, password } = req.body;
    if (!name || !email || !username || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    
    if (users.find((u: any) => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado.' });
    }
    if (users.find((u: any) => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }

    const newUser = {
      id: `u-${Date.now()}`,
      name,
      email,
      username,
      password, // Simple text auth for local storage or demonstration database
      trustPoints: 10, // Starting trust points
      registeredAt: new Date().toISOString()
    };

    users.push(newUser);
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

    // Async sync to sheet
    appendToSheet('Usuarios', [
      newUser.id,
      newUser.registeredAt,
      newUser.name,
      newUser.email,
      newUser.username,
      newUser.trustPoints
    ]);

    res.json({ 
      success: true, 
      user: { id: newUser.id, name: newUser.name, email: newUser.email, username: newUser.username, trustPoints: newUser.trustPoints } 
    });
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
    }

    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    const user = users.find(
      (u: any) => 
        (u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase()) && 
        u.password === password
    );

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        trustPoints: user.trustPoints || 10
      }
    });
  });

  app.get('/api/users/leaderboard', (req, res) => {
    try {
      const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
      const leaderboard = users
        .map((u: any) => ({
          name: u.name,
          username: u.username,
          trustPoints: u.trustPoints !== undefined ? u.trustPoints : 10
        }))
        .sort((a: any, b: any) => b.trustPoints - a.trustPoints)
        .slice(0, 10);
      res.json(leaderboard);
    } catch (e) {
      res.status(500).json({ error: 'Error al obtener la tabla de líderes.' });
    }
  });

  // 2.5 Push Notification Endpoints
  app.get('/api/push/public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Suscripción inválida.' });
    }

    try {
      const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf-8'));
      const exists = subs.some((s: any) => s.endpoint === subscription.endpoint);
      if (!exists) {
        subs.push(subscription);
        fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(subs, null, 2));
      }
      res.status(201).json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Error al registrar suscripción.' });
    }
  });

  // Push helper function
  const broadcastPushNotification = async (payload: { title: string; body: string; data?: any }) => {
    try {
      const subs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf-8'));
      const promises = subs.map((sub: any) => {
        return webPush.sendNotification(sub, JSON.stringify(payload))
          .catch((err: any) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              try {
                const currentSubs = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf-8'));
                const filtered = currentSubs.filter((s: any) => s.endpoint !== sub.endpoint);
                fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(filtered, null, 2));
              } catch (e) {
                console.error(e);
              }
            } else {
              console.error('Error sending push to:', sub.endpoint, err);
            }
          });
      });
      await Promise.all(promises);
    } catch (e) {
      console.error('Error broadcasting push notification', e);
    }
  };

  // Time-to-Live (TTL) configuration: 4 hours
  const TTL_DURATION = 4 * 60 * 60 * 1000;

  const applyReportTTL = () => {
    try {
      const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
      const now = Date.now();
      let hasChanges = false;

      const updatedReports = reports.map((report: any) => {
        if (report.status === 'Activo') {
          const reportedTime = new Date(report.reportedAt).getTime();
          if (now - reportedTime > TTL_DURATION) {
            report.status = 'Despejado';
            hasChanges = true;
            console.log(`[TTL] Reporte ${report.id} marcado automáticamente como 'Despejado' (Expirado 4 horas).`);
          }
        }
        return report;
      });

      if (hasChanges) {
        fs.writeFileSync(REPORTS_PATH, JSON.stringify(updatedReports, null, 2));
      }
      return updatedReports;
    } catch (e) {
      console.error('Error applying report TTL:', e);
      return [];
    }
  };

  // Run TTL check every 5 minutes
  setInterval(applyReportTTL, 5 * 60 * 1000);

  // 3. Reports Endpoints
  app.get('/api/reports', (req, res) => {
    // Return combined reports with TTL applied on-the-fly to guarantee freshness
    const freshReports = applyReportTTL();
    res.json(freshReports);
  });

  app.post('/api/reports', async (req, res) => {
    const { type, description, lat, lng, locationName, creator } = req.body;
    
    if (!type || !lat || !lng || !locationName || !creator) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para el reporte.' });
    }

    const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
    const newReport = {
      id: `r-${Date.now()}`,
      reportedAt: new Date().toISOString(),
      creator,
      lat,
      lng,
      type,
      description: description || '',
      locationName,
      status: 'Activo',
      votesUp: 0,
      votesDown: 0,
      votedUsers: {} // maps username -> 'up' | 'down'
    };

    reports.push(newReport);
    fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));

    // Append to sheet
    appendToSheet('Reportes', [
      newReport.id,
      newReport.reportedAt,
      newReport.creator,
      newReport.lat,
      newReport.lng,
      newReport.type,
      newReport.description,
      newReport.locationName,
      newReport.status,
      newReport.votesUp,
      newReport.votesDown
    ]);

    // Broadcast push notification
    const typeLabel = newReport.type === 'transito' ? 'Control de Tránsito' : newReport.type === 'policia' ? 'Control Policial' : 'Vialidad / Obras';
    broadcastPushNotification({
      title: '🚨 Nuevo Retén Alertado',
      body: `Un ciudadano reportó: ${newReport.locationName} (${typeLabel})`,
      data: { url: '/' }
    });

    res.json({ success: true, report: newReport });
  });

  app.post('/api/reports/:id/vote', async (req, res) => {
    const { id } = req.params;
    const { username, voteType } = req.body; // voteType is 'up' (still there) or 'down' (cleared)

    if (!username || !['up', 'down'].includes(voteType)) {
      return res.status(400).json({ error: 'Voto inválido.' });
    }

    const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
    const reportIndex = reports.findIndex((r: any) => r.id === id);

    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    const report = reports[reportIndex];
    if (!report.votedUsers) report.votedUsers = {};

    const previousVote = report.votedUsers[username];
    if (previousVote === voteType) {
      return res.status(400).json({ error: 'Ya has emitido este mismo voto para este reporte.' });
    }

    // Adjust counts
    if (previousVote) {
      if (previousVote === 'up') report.votesUp = Math.max(0, (report.votesUp || 0) - 1);
      if (previousVote === 'down') report.votesDown = Math.max(0, (report.votesDown || 0) - 1);
    }

    if (voteType === 'up') {
      report.votesUp = (report.votesUp || 0) + 1;
    } else {
      report.votesDown = (report.votesDown || 0) + 1;
    }

    report.votedUsers[username] = voteType;

    // Auto-archive if 5+ downvotes and ratio is highly cleared
    if (report.votesDown >= 3 && report.votesDown > report.votesUp * 2) {
      report.status = 'Despejado';
    }

    reports[reportIndex] = report;
    fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));

    // Sync whole report sheet since columns changed
    const config = getSheetsConfig();
    if (config) {
      syncWholeSheet(
        'Reportes',
        ['ID', 'Fecha de Reporte', 'Usuario Creador', 'Latitud', 'Longitud', 'Tipo de Reten', 'Descripcion', 'Ubicacion Aproximada', 'Estado', 'Votos Si', 'Votos No'],
        reports.map((r: any) => [r.id, r.reportedAt, r.creator, r.lat, r.lng, r.type, r.description, r.locationName, r.status, r.votesUp || 0, r.votesDown || 0])
      );

      // Reward trustPoints to original reporter if upvoted, or reduce if marked fake
      if (voteType === 'up') {
        const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
        const userIndex = users.findIndex((u: any) => u.username === report.creator);
        if (userIndex !== -1) {
          users[userIndex].trustPoints = (users[userIndex].trustPoints || 0) + 1;
          fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
          syncWholeSheet(
            'Usuarios', 
            ['ID', 'Fecha de Registro', 'Nombre', 'Email', 'Nombre de Usuario', 'Puntos de Confianza'],
            users.map((u: any) => [u.id, u.registeredAt, u.name, u.email, u.username, u.trustPoints || 0])
          );
        }
      }
    }

    res.json({ success: true, report });
  });

  app.post('/api/reports/:id/comment', async (req, res) => {
    const { id } = req.params;
    const { username, text } = req.body;

    if (!username || !text || !text.trim()) {
      return res.status(400).json({ error: 'Comentario vacío o inválido.' });
    }

    try {
      const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
      const reportIndex = reports.findIndex((r: any) => r.id === id);

      if (reportIndex === -1) {
        return res.status(404).json({ error: 'Reporte no encontrado.' });
      }

      const report = reports[reportIndex];
      if (!report.comments) {
        report.comments = [];
      }

      const newComment = {
        id: `c-${Date.now()}`,
        creator: username,
        commentedAt: new Date().toISOString(),
        text: text.trim()
      };

      report.comments.push(newComment);
      reports[reportIndex] = report;
      fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));

      res.json({ success: true, comment: newComment });
    } catch (e) {
      res.status(500).json({ error: 'Error al agregar el comentario.' });
    }
  });

  app.put('/api/reports/:id', async (req, res) => {
    const { id } = req.params;
    const { type, description, locationName, username } = req.body;

    if (!username) {
      return res.status(401).json({ error: 'Debes iniciar sesión para editar un reporte.' });
    }

    const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
    const reportIndex = reports.findIndex((r: any) => r.id === id);

    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    const report = reports[reportIndex];
    if (report.creator !== username) {
      return res.status(403).json({ error: 'No tienes permiso para editar este reporte.' });
    }

    if (type) report.type = type;
    if (description !== undefined) report.description = description;
    if (locationName) report.locationName = locationName;

    reports[reportIndex] = report;
    fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));

    const config = getSheetsConfig();
    if (config) {
      syncWholeSheet(
        'Reportes',
        ['ID', 'Fecha de Reporte', 'Usuario Creador', 'Latitud', 'Longitud', 'Tipo de Reten', 'Descripcion', 'Ubicacion Aproximada', 'Estado', 'Votos Si', 'Votos No'],
        reports.map((r: any) => [r.id, r.reportedAt, r.creator, r.lat, r.lng, r.type, r.description, r.locationName, r.status, r.votesUp || 0, r.votesDown || 0])
      );
    }

    res.json({ success: true, report });
  });

  app.post('/api/reports/:id/delete', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;

    if (!username) {
      return res.status(401).json({ error: 'Debes iniciar sesión para eliminar un reporte.' });
    }

    const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
    const reportIndex = reports.findIndex((r: any) => r.id === id);

    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    const report = reports[reportIndex];
    if (report.creator !== username) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este reporte.' });
    }

    reports.splice(reportIndex, 1);
    fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2));

    const config = getSheetsConfig();
    if (config) {
      syncWholeSheet(
        'Reportes',
        ['ID', 'Fecha de Reporte', 'Usuario Creador', 'Latitud', 'Longitud', 'Tipo de Reten', 'Descripcion', 'Ubicacion Aproximada', 'Estado', 'Votos Si', 'Votos No'],
        reports.map((r: any) => [r.id, r.reportedAt, r.creator, r.lat, r.lng, r.type, r.description, r.locationName, r.status, r.votesUp || 0, r.votesDown || 0])
      );
    }

    res.json({ success: true, message: 'Reporte eliminado correctamente.' });
  });

  // Serve static UI assets
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
