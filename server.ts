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

// Ensure database files exist
if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify([], null, 2));
if (!fs.existsSync(REPORTS_PATH)) fs.writeFileSync(REPORTS_PATH, JSON.stringify([], null, 2));

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
  const auth = new google.auth.JWT(
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
    const config = getSheetsConfig();
    res.json({
      isConfigured: !!config,
      clientEmail: config?.clientEmail || '',
      sheetId: config?.sheetId || '',
      sheetLink: config?.sheetId ? `https://docs.google.com/spreadsheets/d/${config.sheetId}` : ''
    });
  });

  app.post('/api/config', async (req, res) => {
    const { clientEmail, privateKey, sheetId } = req.body;
    
    if (!clientEmail || !privateKey || !sheetId) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    try {
      const formattedPrivateKey = privateKey.includes('-----BEGIN PRIVATE KEY-----') 
        ? privateKey 
        : `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;

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
        error: 'No se pudo conectar a Google Sheets. Verifica las credenciales, el ID de la hoja y que hayas compartido la hoja con el correo de la Cuenta de Servicio.',
        details: error.message 
      });
    }
  });

  app.post('/api/config/test', async (req, res) => {
    const { clientEmail, privateKey, sheetId } = req.body;
    try {
      const sheets = getSheetsClient({ clientEmail, privateKey, sheetId });
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

  // 3. Reports Endpoints
  app.get('/api/reports', (req, res) => {
    // Return combined reports
    const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'));
    res.json(reports);
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
