const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

// ☁️ Render / Cloud: use a variável PORT fornecida pelo Render.
//    Localmente cai no fallback 3030.
const PORTA = process.env.PORT || 3030;

// ☁️ DATA_DIR aponta para o Disco Persistente do Render (/data) quando configurado.
//    Localmente usa __dirname como fallback.
const DATA_DIR = process.env.DATA_DIR || __dirname;

const URL_HEARTBEAT = 'https://hc-ping.com/ca6bf5fb-c059-4b8d-8976-32c2b078e495';
const PASTA_ENVIADOS = path.join(DATA_DIR, 'Enviados_para_Nuvem');
const PASTA_ICLOUD_BACKUP = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Backups_MeninoDoAlho');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const PM2_PATH = process.env.PM2_PATH || 'pm2';

function rodarComando(comando) {
    return new Promise((resolve, reject) => {
        exec(comando, { timeout: 15000 }, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve((stdout + '\n' + stderr).trim());
        });
    });
}

// GET /status — retorna estado dos bots via pm2 jlist
app.get('/status', async (req, res) => {
    try {
        const saida = await rodarComando(`${PM2_PATH} jlist`);
        const lista = JSON.parse(saida);

        const bots = {
            'bot-alho': { nome: 'WhatsApp (bot-alho)', status: 'offline', cpu: 0, memoria: 0, uptime: null },
            'bot-site': { nome: 'Upload Python (bot-site)', status: 'offline', cpu: 0, memoria: 0, uptime: null },
        };

        for (const proc of lista) {
            const nome = proc.name;
            if (bots[nome]) {
                bots[nome].status = proc.pm2_env?.status || 'offline';
                bots[nome].cpu = proc.monit?.cpu || 0;
                bots[nome].memoria = Math.round((proc.monit?.memory || 0) / 1024 / 1024);
                bots[nome].uptime = proc.pm2_env?.pm_uptime || null;
            }
        }

        res.json({ ok: true, bots });
    } catch (err) {
        res.json({
            ok: false,
            erro: err.message,
            bots: {
                'bot-alho': { nome: 'WhatsApp (bot-alho)', status: 'offline', cpu: 0, memoria: 0, uptime: null },
                'bot-site': { nome: 'Upload Python (bot-site)', status: 'offline', cpu: 0, memoria: 0, uptime: null },
            }
        });
    }
});

// POST /reiniciar — reinicia apenas os bots (e o painel por último)
app.post('/reiniciar', async (req, res) => {
    try {
        await rodarComando(`${PM2_PATH} restart bot-alho bot-site`);
        res.json({ ok: true, mensagem: 'bot-alho e bot-site reiniciados.' });
    } catch (err) {
        res.json({ ok: false, erro: err.message });
    }
});

// POST /ligar — liga apenas os bots, sem tocar no painel
app.post('/ligar', async (req, res) => {
    try {
        await rodarComando(`${PM2_PATH} start bot-alho bot-site`);
        res.json({ ok: true, mensagem: 'bot-alho e bot-site ligados.' });
    } catch (err) {
        res.json({ ok: false, erro: err.message });
    }
});

// POST /parar — para os bots mas mantém o painel vivo
app.post('/parar', async (req, res) => {
    try {
        await rodarComando(`${PM2_PATH} stop bot-alho bot-site`);
        res.json({ ok: true, mensagem: 'bot-alho e bot-site parados. Painel continua ativo.' });
    } catch (err) {
        res.json({ ok: false, erro: err.message });
    }
});

// POST /comando — controlo individual de cada bot
const BOTS_VALIDOS = ['bot-alho', 'bot-site'];
const ACOES_VALIDAS = ['start', 'stop', 'restart'];

app.post('/comando', async (req, res) => {
    const { bot, acao } = req.body || {};

    if (!BOTS_VALIDOS.includes(bot) || !ACOES_VALIDAS.includes(acao)) {
        return res.json({ ok: false, erro: 'Bot ou ação inválida.' });
    }

    try {
        await rodarComando(`${PM2_PATH} ${acao} ${bot}`);
        const nomes = { start: 'ligado', stop: 'parado', restart: 'reiniciado' };
        res.json({ ok: true, mensagem: `${bot} foi ${nomes[acao]}.` });
    } catch (err) {
        res.json({ ok: false, erro: err.message });
    }
});

// GET /logs — últimas linhas de log de cada bot
app.get('/logs', async (req, res) => {
    const resultado = { 'bot-alho': '', 'bot-site': '' };

    for (const nome of Object.keys(resultado)) {
        try {
            const saida = await rodarComando(
                `${PM2_PATH} logs ${nome} --lines 5 --nostream 2>&1`
            );
            const linhas = saida
                .split('\n')
                .filter(l => !l.startsWith('[TAILING]') && !l.startsWith('PM2') && l.trim() !== '')
                .slice(-5);
            resultado[nome] = linhas.join('\n');
        } catch {
            resultado[nome] = '(sem logs disponíveis)';
        }
    }

    res.json({ ok: true, logs: resultado });
});

// GET /contagem — conta PDFs na pasta Enviados_para_Nuvem
app.get('/contagem', (req, res) => {
    try {
        if (!fs.existsSync(PASTA_ENVIADOS)) {
            return res.json({ ok: true, total: 0 });
        }
        const arquivos = fs.readdirSync(PASTA_ENVIADOS)
            .filter(f => f.toLowerCase().endsWith('.pdf'));
        res.json({ ok: true, total: arquivos.length });
    } catch (err) {
        res.json({ ok: false, total: 0, erro: err.message });
    }
});

// GET /arquivos-enviados — últimos 15 PDFs enviados, do mais recente ao mais antigo
app.get('/arquivos-enviados', (req, res) => {
    try {
        if (!fs.existsSync(PASTA_ENVIADOS)) {
            return res.json({ ok: true, arquivos: [] });
        }
        const arquivos = fs.readdirSync(PASTA_ENVIADOS)
            .filter(f => f.toLowerCase().endsWith('.pdf'))
            .map(f => {
                const stat = fs.statSync(path.join(PASTA_ENVIADOS, f));
                return { nome: f, modificado: stat.mtimeMs };
            })
            .sort((a, b) => b.modificado - a.modificado)
            .slice(0, 15)
            .map(f => ({ nome: f.nome, data: new Date(f.modificado).toISOString() }));
        res.json({ ok: true, arquivos });
    } catch (err) {
        res.json({ ok: false, arquivos: [], erro: err.message });
    }
});

// GET /abrir-documento/:id — serve o PDF original pelo número da NF
app.get('/abrir-documento/:id', (req, res) => {
    try {
        const id = req.params.id;
        if (!id || id === 'SN') return res.status(404).send('Documento não encontrado no servidor local.');

        if (!fs.existsSync(PASTA_ENVIADOS)) return res.status(404).send('Pasta de documentos não encontrada.');

        const encontrado = fs.readdirSync(PASTA_ENVIADOS)
            .filter(f => f.toLowerCase().endsWith('.pdf'))
            .find(f => f.includes(id));

        if (encontrado) {
            res.sendFile(path.join(PASTA_ENVIADOS, encontrado));
        } else {
            res.status(404).send('Documento não encontrado no servidor local.');
        }
    } catch (err) {
        res.status(500).send('Erro ao procurar documento: ' + err.message);
    }
});

// GET /api/financeiro — dados do gestor financeiro
app.get('/api/financeiro', (req, res) => {
    try {
        const caminho = path.join(DATA_DIR, 'dados_financeiros.json');
        if (fs.existsSync(caminho)) {
            const raw = fs.readFileSync(caminho, 'utf-8');
            return res.json(JSON.parse(raw));
        }
        res.json({ boletos: [], notas: [] });
    } catch (err) {
        res.json({ boletos: [], notas: [], erro: err.message });
    }
});

// POST /forcar-backup — sincroniza PDFs e dados para o iCloud Drive
app.post('/forcar-backup', (req, res) => {
    try {
        if (!fs.existsSync(PASTA_ICLOUD_BACKUP)) {
            fs.mkdirSync(PASTA_ICLOUD_BACKUP, { recursive: true });
        }

        let novos = 0;

        // 1. Copiar PDFs de Enviados_para_Nuvem
        if (fs.existsSync(PASTA_ENVIADOS)) {
            const pdfs = fs.readdirSync(PASTA_ENVIADOS)
                .filter(f => f.toLowerCase().endsWith('.pdf'));

            for (const pdf of pdfs) {
                const destino = path.join(PASTA_ICLOUD_BACKUP, pdf);
                if (!fs.existsSync(destino)) {
                    fs.copyFileSync(path.join(PASTA_ENVIADOS, pdf), destino);
                    novos++;
                }
            }
        }

        // 2. Copiar dados_financeiros.json (sempre substitui)
        const jsonOrigem = path.join(DATA_DIR, 'dados_financeiros.json');
        if (fs.existsSync(jsonOrigem)) {
            fs.copyFileSync(jsonOrigem, path.join(PASTA_ICLOUD_BACKUP, 'dados_financeiros.json'));
        }

        res.json({
            ok: true,
            novos,
            mensagem: novos > 0
                ? `Sincronização concluída! ${novos} ficheiro(s) novo(s) copiado(s) para o iCloud.`
                : 'Tudo sincronizado! Nenhum ficheiro novo para copiar.'
        });
    } catch (err) {
        res.json({ ok: false, erro: err.message });
    }
});

// POST /reconstruir-historico — lê PDFs antigos em segundo plano
app.post('/reconstruir-historico', (req, res) => {
    const { spawn } = require('child_process');
    const script = path.join(__dirname, 'reconstruir.js');

    if (!fs.existsSync(script)) {
        return res.json({ ok: false, erro: 'Ficheiro reconstruir.js não encontrado.' });
    }

    const processo = spawn('node', [script], { cwd: __dirname });

    processo.stdout.on('data', (data) => console.log(`[Reconstrutor]: ${data.toString().trim()}`));
    processo.stderr.on('data', (data) => console.error(`[Reconstrutor Erro]: ${data.toString().trim()}`));
    processo.on('close', (code) => console.log(`[Reconstrutor]: Finalizado com código ${code}`));

    res.json({ ok: true, mensagem: 'Reconstrução iniciada em segundo plano! Acompanhe o progresso nos logs.' });
});

app.post('/api/limpeza-nuclear', (req, res) => {
    // Reinicialização segura: limpa os logs pesados e reinicia o processo no PM2.
    // NÃO apaga a pasta de autenticação (.wwebjs_auth) — o WhatsApp mantém a sessão activa.
    // NÃO usa pkill — evita "Operation not permitted" no macOS sem sudo.
    const comando = 'pm2 flush && pm2 restart bot-alho';

    exec(comando, (error, stdout, stderr) => {
        if (error) {
            console.error('❌ Erro na reinicialização segura:', stderr);
            return res.json({ success: false, message: '❌ Erro ao reiniciar o bot via PM2. Verifique se o PM2 está activo nos logs.' });
        }
        console.log('🔄 Reinicialização Segura executada via PM2');
        res.json({ success: true, message: '✅ Bot reiniciado com segurança! A sessão do WhatsApp foi mantida — não é necessário ler o QR Code novamente.' });
    });
});

// GET /api/status-celular — lê o ficheiro wp_status.json gerado pelo index.js
app.get('/api/status-celular', (req, res) => {
    try {
        const caminho = path.join(DATA_DIR, 'wp_status.json');
        if (!fs.existsSync(caminho)) {
            return res.json({ status: 'desconhecido' });
        }
        const raw = fs.readFileSync(caminho, 'utf-8');
        res.json(JSON.parse(raw));
    } catch (err) {
        res.json({ status: 'desconhecido', erro: err.message });
    }
});

// GET /api/whatsapp/qr — retorna o QR Code atual em Base64 (gerado pelo index.js)
app.get('/api/whatsapp/qr', (req, res) => {
    try {
        const caminho = path.join(DATA_DIR, 'qr_current.json');
        if (!fs.existsSync(caminho)) {
            return res.json({ qr: null });
        }
        const raw = fs.readFileSync(caminho, 'utf-8');
        const dados = JSON.parse(raw);
        // QR expira após 60 segundos sem atualização
        const expirado = (Date.now() - (dados.ts || 0)) > 60000;
        if (expirado || !dados.qr) {
            return res.json({ qr: null });
        }
        res.json({ qr: dados.qr });
    } catch (err) {
        res.json({ qr: null, erro: err.message });
    }
});

app.listen(PORTA, '0.0.0.0', () => {
    console.log(`🧄 Painel "Menino do Alho" rodando em http://0.0.0.0:${PORTA}`);
    console.log(`🌐 Acesse de outro dispositivo na rede: http://<IP-DO-MAC>:${PORTA}`);
});

// Heartbeat — ping a cada 5 minutos para monitorização externa
setInterval(() => {
    fetch(URL_HEARTBEAT).catch(e => console.log("Erro Heartbeat:", e.message));
    console.log("💓 Heartbeat enviado.");
}, 300000);
