const qrcode = require('qrcode-terminal');
const QRCodeLib = require('qrcode');
const pdf = require('pdf-parse');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const cron = require('node-cron');
const path = require('path');
const os = require('os');
const http = require('http');
const pino = require('pino');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ☁️ Render / Cloud: DATA_DIR aponta para o Disco Persistente (/data) quando configurado.
// Localmente, usa __dirname como fallback.
const DATA_DIR = process.env.DATA_DIR || __dirname;

const CAMINHO_DADOS_FINANCEIROS = path.join(DATA_DIR, 'dados_financeiros.json');
const CAMINHO_WP_STATUS = path.join(DATA_DIR, 'wp_status.json');
const CAMINHO_QR_ATUAL = path.join(DATA_DIR, 'qr_current.json');
const PASTA_AUTH_BAILEYS = path.join(DATA_DIR, 'auth_info_baileys');

function gravarStatusWP(status) {
    try {
        fs.writeFileSync(CAMINHO_WP_STATUS, JSON.stringify({ status, ts: Date.now() }), 'utf-8');
    } catch (err) {
        console.warn('⚠️ Não foi possível gravar wp_status.json:', err.message);
    }
}

function gravarQRAtual(base64OrNull) {
    try {
        fs.writeFileSync(CAMINHO_QR_ATUAL, JSON.stringify({ qr: base64OrNull, ts: Date.now() }), 'utf-8');
    } catch (err) {
        console.warn('⚠️ Não foi possível gravar qr_current.json:', err.message);
    }
}

// ☁️ iCloud Drive — O Cofre (Fase 2)
const PASTA_ICLOUD = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Backups_MeninoDoAlho');
const PASTA_ICLOUD_BOLETOS = path.join(PASTA_ICLOUD, 'boletos');
const PASTA_ICLOUD_NOTAS = path.join(PASTA_ICLOUD, 'notas');

[PASTA_ICLOUD, PASTA_ICLOUD_BOLETOS, PASTA_ICLOUD_NOTAS].forEach(p => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});
console.log(`☁️ Cofre iCloud ativo: ${PASTA_ICLOUD}`);

// Telegram — Notificações de Sistema
const TELEGRAM_TOKEN = '8796139178:AAFZ33AFzR2biFHjjuocTBGjkYh0siISsJ0';
const TELEGRAM_CHAT_ID = '8508800710';

const enviarTelegram = async (mensagem) => {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.log("Erro ao enviar Telegram:", err);
    }
};

// ========================================================
// 🔌 CONEXÃO WHATSAPP — Baileys (sem Puppeteer/Chrome)
// ========================================================
let sock = null;
let botIniciando = false;
let reconexaoAgendada = null;
const startupTime = Math.floor(Date.now() / 1000);
const baileysLogger = pino({ level: 'silent' });

async function fecharSocketAnterior() {
    if (!sock) return;
    try {
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('messages.upsert');
        sock.end(undefined);
    } catch (_) {
        // ignora — socket já pode estar morto
    }
    sock = null;
}

async function responderMensagem(jid, texto) {
    if (!sock || !jid) return;
    try {
        await sock.sendMessage(jid, { text: texto });
    } catch (err) {
        console.error('❌ Falha ao responder no WhatsApp:', err?.message || err);
    }
}

async function processarPdfRecebido(msg, buffer, nomeOriginal) {
    console.log('📄 PDF detectado! Iniciando triagem...');
    const jid = msg.key.remoteJid;

    try {
        const data = await pdf(buffer);
        const text = data.text;

        const tipoDoc = identificarTipoDocumento(text);
        console.log(`🔎 Tipo identificado: ${tipoDoc}`);

        if (tipoDoc === 'DANFE') {
            const dados = extrairDadosNF(text);
            let avisoDuplicado = "";
            const pastaNotas = './notas';
            const pastaOriginais = './notas/originais';

            if (!fs.existsSync(pastaNotas)) fs.mkdirSync(pastaNotas, { recursive: true });
            if (!fs.existsSync(pastaOriginais)) fs.mkdirSync(pastaOriginais, { recursive: true });

            const caminhoOriginal = `${pastaOriginais}/${nomeOriginal}`;

            if (fs.existsSync(caminhoOriginal)) {
                console.log(`⚠️ Arquivo duplicado detectado: ${nomeOriginal}. Permitindo fluxo para testes.`);
                avisoDuplicado = "⚠️ *Aviso (Modo Teste):* Este arquivo já constava no sistema, mas os dados extraídos estão abaixo:\n\n";
            }

            fs.writeFileSync(caminhoOriginal, buffer);

            const nomeArquivo = sanitizarNome(`NF_${dados.numero}_${dados.emitente}.pdf`);
            const caminhoArquivo = `${pastaNotas}/${nomeArquivo}`;
            fs.writeFileSync(caminhoArquivo, buffer);

            enviarParaNuvem(caminhoArquivo, nomeArquivo, 'DANFE').catch(err => {
                console.error(`☁️ [Upload] ❌ Upload da DANFE falhou: ${err.message}`);
                enviarTelegram(`⚠️ *Menino do Alho:* Falha ao enviar DANFE para o painel!\nArquivo: ${nomeArquivo}\nErro: ${err.message}`).catch(() => {});
            });

            guardarNota(dados);
            copiarParaIcloud(caminhoArquivo, nomeArquivo, 'DANFE');

            const delayDANFE = Math.floor(Math.random() * 3000) + 3000;
            console.log(`⏳ Esperando ${delayDANFE}ms para parecer humano...`);

            setTimeout(() => {
                responderMensagem(jid, avisoDuplicado + `✅ *Nota Fiscal (DANFE) Recebida!*\n\n` +
                          `🏢 *Emitente:* ${dados.emitente}\n` +
                          `📦 *Destinatário:* ${dados.destinatario}\n` +
                          `📄 *Número:* ${dados.numero}\n` +
                          `💰 *Valor Total:* ${dados.valor}\n\n` +
                          `📂 Original e cópia arquivados.`);
            }, delayDANFE);

        } else if (tipoDoc === 'BOLETO') {
            const dados = await extrairDadosBoleto(text);
            let avisoDuplicado = "";
            const pastaBoletos = './boletos';
            const pastaOriginais = './boletos/originais';

            if (!fs.existsSync(pastaBoletos)) fs.mkdirSync(pastaBoletos, { recursive: true });
            if (!fs.existsSync(pastaOriginais)) fs.mkdirSync(pastaOriginais, { recursive: true });

            const caminhoOriginal = `${pastaOriginais}/${nomeOriginal}`;

            if (fs.existsSync(caminhoOriginal)) {
                console.log(`⚠️ Arquivo duplicado detectado: ${nomeOriginal}. Permitindo fluxo para testes.`);
                avisoDuplicado = "⚠️ *Aviso (Modo Teste):* Este arquivo já constava no sistema, mas os dados extraídos estão abaixo:\n\n";
            }

            fs.writeFileSync(caminhoOriginal, buffer);

            let dataNome = 'Data_Indefinida';
            if (dados.vencimento && dados.vencimento.includes('/')) {
                dataNome = dados.vencimento.split('/').reverse().join('-');
            }

            const nomeArquivo = sanitizarNome(`${dataNome}_${dados.beneficiario}_NF${dados.nf}.pdf`);
            const caminhoArquivo = `${pastaBoletos}/${nomeArquivo}`;
            fs.writeFileSync(caminhoArquivo, buffer);

            enviarParaNuvem(caminhoArquivo, nomeArquivo, 'BOLETO').catch(err => {
                console.error(`☁️ [Upload] ❌ Upload do BOLETO falhou: ${err.message}`);
                enviarTelegram(`⚠️ *Menino do Alho:* Falha ao enviar Boleto para o painel!\nArquivo: ${nomeArquivo}\nErro: ${err.message}`).catch(() => {});
            });

            guardarBoleto(dados);
            copiarParaIcloud(caminhoArquivo, nomeArquivo, 'BOLETO');
            criarLembreteMac(dados.pagador, dados.beneficiario, dados.vencimento, dados.nf);

            const delayBoleto = Math.floor(Math.random() * 3000) + 3000;
            console.log(`⏳ Esperando ${delayBoleto}ms para parecer humano...`);

            setTimeout(() => {
                responderMensagem(jid, avisoDuplicado + `✅ *Boleto Processado!*\n\n` +
                          `🛒 *Pagador:* ${dados.pagador}\n` +
                          `💰 *Beneficiário:* ${dados.beneficiario}\n` +
                          `💵 *Valor:* R$ ${dados.valor}\n` +
                          `📅 *Vencimento:* ${dados.vencimento}\n` +
                          `📝 *NF Ref:* ${dados.nf}\n\n` +
                          `📂 Original e cópia arquivados. Agendado no Mac.`);
            }, delayBoleto);
        } else {
            console.log('⚠️ Documento não reconhecido como Boleto ou DANFE.');
            await responderMensagem(jid, '⚠️ Recebi o PDF, mas não identifiquei se é Boleto ou Nota Fiscal.');
        }

    } catch (err) {
        console.error('❌ Erro ao processar:', err?.message || err);
        if (err?.stack) console.error(err.stack);
        await responderMensagem(jid, '❌ Ocorreu um erro ao ler esse arquivo.');
    }
}

async function iniciarBot() {
    if (botIniciando) {
        console.warn('⚠️ iniciarBot() já em andamento — ignorando chamada duplicada.');
        return;
    }
    botIniciando = true;

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            downloadMediaMessage,
            DisconnectReason,
            fetchLatestBaileysVersion
        } = await import('@whiskeysockets/baileys');
        const { Boom } = await import('@hapi/boom');

        // Fecha socket anterior antes de criar um novo (evita erro 440 Connection Replaced)
        await fecharSocketAnterior();

        const { state, saveCreds } = await useMultiFileAuthState(PASTA_AUTH_BAILEYS);

        // Versão dinâmica do protocolo — evita rejeição 405 da Meta
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Baileys WA version: ${version.join('.')} (latest: ${isLatest})`);

        sock = makeWASocket({
            version,
            auth: state,
            logger: baileysLogger,
            printQRInTerminal: false,
            // 👻 MODO FANTASMA: não marca a sessão como online — preserva push no celular
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrcode.generate(qr, { small: true });
                console.log('📲 Por favor, escaneie o QR Code acima!');
                gravarStatusWP('qr_code');
                try {
                    const base64 = await QRCodeLib.toDataURL(qr, { margin: 1, width: 300 });
                    gravarQRAtual(base64);
                    console.log('🖼️ QR Code salvo para exibição no painel web.');
                } catch (err) {
                    console.warn('⚠️ Falha ao gerar QR base64:', err.message);
                }
            }

            if (connection === 'open') {
                console.log('✅ Cliente WhatsApp (Baileys) conectado e pronto!');
                console.log('🤖 Bot Financeiro (Boletos & NFs) iniciado!');
                enviarTelegram('🟢 *Menino do Alho:* Sistema Iniciado e WhatsApp Conectado!');
                gravarStatusWP('conectado');
                gravarQRAtual(null); // limpa o QR ao conectar
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : lastDisconnect?.error?.output?.statusCode;

                console.warn('🔌 Bot desconectado. statusCode:', statusCode);
                gravarStatusWP('desconectado');
                gravarQRAtual(null); // limpa o QR ao desconectar

                // Códigos que NÃO devem reconectar (evita loop infinito do 440)
                const naoReconectar = [
                    DisconnectReason.loggedOut,           // 401
                    DisconnectReason.connectionReplaced,  // 440 — outra sessão tomou o lugar
                    DisconnectReason.forbidden,           // 403
                    DisconnectReason.multideviceMismatch, // 411
                    DisconnectReason.badSession           // 500
                ];

                if (naoReconectar.includes(statusCode)) {
                    if (statusCode === DisconnectReason.connectionReplaced) {
                        console.error('🚫 Erro 440 (Connection Replaced): outra instância tomou a sessão.');
                        console.error('💡 Pare processos duplicados: pm2 stop bot-alho && pm2 delete bot-alho');
                        console.error('💡 Se persistir: rm -rf auth_info_baileys && reinicie para novo QR.');
                    } else if (statusCode === DisconnectReason.badSession) {
                        console.error('🚫 Sessão corrompida (badSession). Apague auth_info_baileys e escaneie o QR de novo.');
                    } else if (statusCode === DisconnectReason.loggedOut) {
                        console.error('🔒 Sessão encerrada (logged out). Apague auth_info_baileys e reinicie para novo QR.');
                    } else {
                        console.error(`🔒 Desconexão permanente (código ${statusCode}). Sem reconexão automática.`);
                    }
                    return;
                }

                // Reconexão controlada — apenas uma tentativa agendada por vez
                if (reconexaoAgendada) clearTimeout(reconexaoAgendada);
                console.warn('🔄 Tentando reconectar em 5 segundos...');
                reconexaoAgendada = setTimeout(() => {
                    reconexaoAgendada = null;
                    gravarStatusWP('iniciando');
                    iniciarBot().catch(err => {
                        console.error('❌ Falha ao reconectar:', err.message);
                        gravarStatusWP('desconectado');
                    });
                }, 5000);
            }
        });

        // ========================================================
        // 📨 MONITORAMENTO DE MENSAGENS (Baileys)
        // ========================================================
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            // Ignora sincronização de histórico antigo
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    // Blindagem: ignora mensagens enviadas pelo próprio bot/dono da conta
                    if (msg.key.fromMe) continue;

                    if (!msg.message) continue;

                    const ts = Number(msg.messageTimestamp || 0);
                    if (ts && ts < startupTime) continue;

                    const doc =
                        msg.message.documentMessage ||
                        msg.message.documentWithCaptionMessage?.message?.documentMessage;

                    if (!doc) continue;

                    const mimetype = doc.mimetype || '';
                    const fileName = doc.fileName || `documento_${Date.now()}.pdf`;
                    const ehPdf =
                        mimetype.includes('pdf') ||
                        fileName.toLowerCase().endsWith('.pdf');

                    if (!ehPdf) {
                        console.log(`ℹ️ Documento ignorado (não é PDF). Mimetype: ${mimetype} | Nome: ${fileName}`);
                        continue;
                    }

                    console.log('📎 PDF/Documento detectado. Mimetype:', mimetype, '| Nome:', fileName);

                    // Rate limit: atraso humano (2–4s) antes de baixar/processar, evita gatilho de spam
                    const delayHumano = Math.floor(Math.random() * 2000) + 2000;
                    console.log(`⏳ Aguardando ${delayHumano}ms (reação humana) antes de processar...`);
                    await delay(delayHumano);

                    let buffer;
                    try {
                        console.log('⬇️ Baixando mídia via Baileys downloadMediaMessage...');
                        buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            {
                                logger: baileysLogger,
                                reuploadRequest: sock.updateMediaMessage
                            }
                        );
                        console.log('✅ Download concluído. Bytes:', buffer?.length || 0);
                    } catch (error) {
                        console.error('❌ Erro ao baixar mídia:', error?.message || error);
                        if (error?.stack) console.error(error.stack);
                        continue;
                    }

                    if (!buffer || !buffer.length) {
                        console.warn('⚠️ downloadMediaMessage devolveu buffer vazio — ficheiro ignorado.');
                        continue;
                    }

                    await processarPdfRecebido(msg, buffer, fileName);
                } catch (err) {
                    console.error('❌ Erro no listener de mensagens:', err?.message || err);
                }
            }
        });
    } finally {
        botIniciando = false;
    }
}


gravarStatusWP('iniciando');
iniciarBot().catch(err => {
    console.error('❌ Erro fatal ao inicializar o bot:', err.message);
    console.error('');
    console.error('===================================================');
    console.error('  💡 SOLUÇÃO: Apague a sessão Baileys e reinicie');
    console.error('===================================================');
    console.error('  rm -rf auth_info_baileys');
    console.error('  node index.js');
    console.error('===================================================');
    gravarStatusWP('desconectado');
    process.exit(1);
});

// ========================================================
// 🧠 CÉREBRO: Funções Auxiliares
// ========================================================

// ========================================================
// ☁️ UPLOAD PARA NUVEM — Bot → Flask (Render)
// ========================================================
// Configuração centralizada: defina API_URL e API_BOT_TOKEN no .env (ou
// nas variáveis de ambiente do Render) para não depender de valores hardcoded.
const API_URL = process.env.API_URL || 'https://sistema-menino-do-alho.onrender.com';
const API_BOT_TOKEN = process.env.API_BOT_TOKEN || 'ALHO_BOT_SUPER_SECRETO_2026_XYZ';

async function enviarParaNuvem(caminhoArquivo, nomeArquivo, tipoDoc) {
    const tipoEnvio = tipoDoc === 'DANFE' ? 'nfe' : 'boleto';
    const endpointCompleto = `${API_URL}/api/bot/upload`;

    // ────────────────────────────────────────────────────────────────
    // 🔍 PRÉ-DIAGNÓSTICO — imprime ANTES de qualquer chamada de rede
    // Esses logs são a primeira coisa a checar no Railway/Render/PM2.
    // ────────────────────────────────────────────────────────────────
    console.log('='.repeat(60));
    console.log(`☁️ [Upload] >>> INICIANDO ENVIO PARA O SERVIDOR <<<`);
    console.log(`☁️ [Upload] Arquivo  : ${nomeArquivo}`);
    console.log(`☁️ [Upload] Tipo     : ${tipoEnvio}`);
    console.log(`☁️ [Upload] URL alvo : ${endpointCompleto}`);
    console.log(`☁️ [Upload] Var API_URL      (env) : ${process.env.API_URL || '(não definida — usando fallback hardcoded)'}`);
    console.log(`☁️ [Upload] Token configurado?     : ${!!process.env.API_BOT_TOKEN} ${process.env.API_BOT_TOKEN ? '(via env)' : '(usando fallback hardcoded)'}`);
    console.log(`☁️ [Upload] Arquivo existe no disco: ${fs.existsSync(caminhoArquivo)}`);
    if (fs.existsSync(caminhoArquivo)) {
        const tamanho = fs.statSync(caminhoArquivo).size;
        console.log(`☁️ [Upload] Tamanho do arquivo     : ${tamanho} bytes${tamanho === 0 ? ' ⚠️ ARQUIVO VAZIO!' : ''}`);
    }
    console.log('='.repeat(60));
    // ────────────────────────────────────────────────────────────────

    try {
        const formData = new FormData();
        // MIME type explícito garante que o Flask aceite o arquivo como PDF
        formData.append('file', fs.createReadStream(caminhoArquivo), {
            filename: nomeArquivo,
            contentType: 'application/pdf',
        });
        formData.append('tipo', tipoEnvio);
        formData.append('nome', nomeArquivo);

        console.log(`☁️ [Upload] 🚀 Disparando requisição POST para: ${endpointCompleto}`);

        const resposta = await axios.post(endpointCompleto, formData, {
            headers: {
                ...formData.getHeaders(),
                'X-API-KEY': API_BOT_TOKEN,
            },
            timeout: 90000, // 90 segundos (Render pode demorar a acordar)
        });

        console.log(`☁️ [Upload] ✅ Resposta recebida! Status HTTP: ${resposta.status}`);
        console.log(`☁️ [Upload] Corpo da resposta: ${JSON.stringify(resposta.data)}`);

        if (resposta.data && resposta.data.documento_id) {
            console.log(`☁️ [Upload] 🎉 Documento registrado no banco com ID: ${resposta.data.documento_id}`);
        } else {
            console.warn(`☁️ [Upload] ⚠️ Status 200 recebido MAS sem documento_id — o registro pode NÃO ter sido salvo no banco!`);
        }
    } catch (erro) {
        // ── Servidor respondeu com erro HTTP (4xx / 5xx) ────────────
        if (erro.response) {
            console.error(`☁️ [Upload] ❌ FALHA HTTP — Servidor recusou com status: ${erro.response.status}`);
            console.error(`☁️ [Upload] Corpo da resposta de erro: ${JSON.stringify(erro.response.data)}`);
            const dicas = {
                400: '💡 400 Bad Request — MIME type rejeitado, campo "tipo" inválido ou arquivo corrompido.',
                403: '💡 403 Forbidden — API_BOT_TOKEN ausente ou incorreto no servidor (Render).',
                404: '💡 404 Not Found — Endpoint /api/bot/upload não existe ou Blueprint não registrado.',
                429: '💡 429 Too Many Requests — rate-limit atingido (10 req/min). Aguarde e tente novamente.',
                500: '💡 500 Internal Server Error — exceção não tratada no Flask. Veja os logs do Gunicorn.',
                503: '💡 503 Service Unavailable — API_BOT_TOKEN não configurado no ambiente do servidor.',
            };
            const dica = dicas[erro.response.status] || `💡 Erro ${erro.response.status} inesperado.`;
            console.error(`☁️ [Upload] ${dica}`);

        // ── Erro de rede (sem resposta do servidor) ──────────────────
        } else if (erro.request) {
            const codigo = erro.code || 'DESCONHECIDO';
            console.error(`☁️ [Upload] ❌ FALHA DE REDE — Nenhuma resposta recebida do servidor.`);
            console.error(`☁️ [Upload] URL tentada   : ${endpointCompleto}`);
            console.error(`☁️ [Upload] Código do erro: ${codigo}`);

            const dicasRede = {
                ECONNREFUSED : '💡 ECONNREFUSED — Servidor recusou a conexão. Está rodando? Porta correta?',
                ENOTFOUND    : '💡 ENOTFOUND — DNS falhou. Domínio não existe ou sem acesso à internet.',
                ECONNRESET   : '💡 ECONNRESET — Conexão derrubada pelo servidor no meio da transferência.',
                ETIMEDOUT    : '💡 ETIMEDOUT — Timeout de conexão. Servidor muito lento ou firewall bloqueando.',
                ECONNABORTED : '💡 ECONNABORTED — axios cancelou por timeout (90s excedido). Arquivo muito grande?',
                ERR_BAD_RESPONSE: '💡 ERR_BAD_RESPONSE — Resposta malformada do servidor (possível proxy ou 502).',
            };
            const dicaRede = dicasRede[codigo] || `💡 Erro de rede desconhecido (${codigo}). Verifique conectividade.`;
            console.error(`☁️ [Upload] ${dicaRede}`);

        // ── Erro interno do axios (antes de enviar) ──────────────────
        } else {
            console.error(`☁️ [Upload] ❌ FALHA INTERNA — Erro ao montar a requisição: ${erro.message}`);
            if (erro.stack) console.error(`☁️ [Upload] Stack: ${erro.stack}`);
        }

        // Re-lança para o .catch() do chamador poder notificar via Telegram
        throw erro;
    }
}

// Remove caracteres proibidos em nomes de arquivos (/ \ : * ? " < > |)
function sanitizarNome(nome) {
    if (!nome) return 'documento_sem_nome';
    return nome.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_');
}

function identificarTipoDocumento(text) {
    if (text.match(/DANFE|Nota Fiscal Eletrônica|Chave de acesso/i)) {
        return 'DANFE';
    }
    // Verifica palavras comuns de boleto
    if (text.match(/Boleto|Pagador|Beneficiário|Nosso Número|Linha Digitável|341-7|237-2/i)) {
        return 'BOLETO';
    }
    return 'DESCONHECIDO';
}

// --- EXTRAÇÃO DE NOTA FISCAL (DANFE) - VERSÃO V5 (ALCANCE LONGO) ---
function extrairDadosNF(text) {
    console.log("=== TEXTO BRUTO DO PDF (DANFE) ===");
    console.log(text);
    console.log("==================================");
    const lines = text.split(/\r\n|\n|\r/);
    let numero = 'SN';
    let valor = '0,00';
    let emitente = 'Desconhecido';
    let destinatario = 'Não identificado';

    // 1. Número da NF
    const matchNum = text.match(/N[º°o]\.?\s*(\d+)/i);
    if (matchNum) {
        numero = parseInt(matchNum[1], 10).toString();
    }

    // 2. Valor Total (O Caçador de DANFEs)
    valor = "0,00";
    let linhaValorTotal = '';
    
    // Tática A: Busca o valor que fica espremido antes da seção TRANSPORTADOR (Padrão REIS COMERCIO)
    const matchTransportador = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})[\s\r\n]*(?:0,00[\s\r\n]*)*TRANSPORTADOR/i);
    
    // Tática B: Busca o valor que vem com a tag PARCELAS e o R$
    const matchParcelas = text.match(/PARCELAS[\s\S]{1,50}?(?:R\$|R\s\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);

    if (matchTransportador) {
        valor = matchTransportador[1];
        linhaValorTotal = matchTransportador[0];
    } else if (matchParcelas) {
        valor = matchParcelas[1];
        linhaValorTotal = matchParcelas[0];
    } else {
        // Tática C: Fallbacks originais
        const regexValorNota = /VALOR TOTAL DA NOTA[\s\S]{1,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
        const matchValor = text.match(regexValorNota);
        if (matchValor) {
            valor = matchValor[1];
            linhaValorTotal = matchValor[0];
        }
    }

    // Limpa zeros à esquerda em linhas coladas (ex.: 0,000,000,001.600,00)
    const regexValorLimpo = /(?:^|[^0-9])([1-9]\d{0,2}(?:\.\d{3})*,\d{2})/g;
    let matchValorLimpo;
    let ultimoValorValido;
    while ((matchValorLimpo = regexValorLimpo.exec(linhaValorTotal)) !== null) {
        ultimoValorValido = matchValorLimpo[1];
    }
    let valorFinal = ultimoValorValido || valor;
    // Captura o padrão monetário no final da linha de totais
    if (linhaValorTotal) {
        const regexMonetarioFinal = /(\d{1,3}(?:\.\d{3})*,\d{2})$/;
        const matchValorFinal = linhaValorTotal.match(regexMonetarioFinal);
        if (matchValorFinal) {
            valorFinal = matchValorFinal[1];
        }
    }
    valor = valorFinal;

    // 3. Emitente
    for (let i = 0; i < 20; i++) {
        let l = lines[i] ? lines[i].trim() : '';
        if (l.length > 5 && !l.includes('DANFE') && !l.match(/^\d{2}\//)) {
            if (l.toUpperCase().includes('RECEBEMOS DE')) {
                l = l.replace(/RECEBEMOS DE/i, '').trim();
            }
            l = l.split(/OS PRODUTOS|OS SERVIÇOS|CONSTANTES|CNPJ|\(/i)[0].trim();
            if (l.length > 3 && !l.includes('DESTINATARIO')) {
                emitente = l;
                break;
            }
        }
    }
    if (emitente.length > 30) emitente = emitente.substring(0, 30).trim();

    // 4. Destinatário
    // 1. Nome do Destinatário
    const matchDest = text.match(/DESTINAT[AÁ]RIO\s*\/\s*REMETENTE[\r\n]+([^\r\n]+)/i);
    if (matchDest) {
        destinatario = matchDest[1].trim();
    } else {
        // Fallback pelo scanner de linhas
        for (let i = 0; i < lines.length; i++) {
            const linhaAtual = lines[i].toUpperCase();
            
            if (linhaAtual.includes('DESTINATARIO') || linhaAtual.includes('REMETENTE')) {
                // AUMENTADO: Varre as próximas 12 linhas (antes eram 6)
                for (let j = 1; j <= 12; j++) {
                    if (i + j < lines.length) {
                        let candidato = lines[i + j].trim();
                        const candidatoUpper = candidato.toUpperCase();
                        
                        // ⛔️ LISTA PROIBIDA (Atualizada)
                        const ehLixo = 
                            candidato.length < 3 ||
                            candidatoUpper.includes('NOME') || 
                            candidatoUpper.includes('RAZÃO') || 
                            candidatoUpper.includes('SOCIAL') || 
                            candidatoUpper.includes('ENDEREÇO') || 
                            candidatoUpper.includes('INSCRIÇÃO') || 
                            candidatoUpper.includes('SUBST') ||
                            candidatoUpper.includes('CNPJ') ||
                            candidatoUpper.includes('CPF') ||
                            candidatoUpper.includes('FONE') ||
                            candidatoUpper.includes('DATA') ||     
                            candidatoUpper.includes('SAÍDA') ||    
                            candidatoUpper.includes('ENTRADA') ||  
                            candidatoUpper.includes('HORA') ||
                            candidatoUpper.includes('BAIRRO') ||
                            candidatoUpper.includes('CEP') ||
                            candidatoUpper.includes('MUNICÍPIO') ||
                            candidatoUpper.includes('FATURA') ||
                            candidatoUpper.includes('DUPLICATA') ||
                            candidatoUpper.includes('VENCIMENTO');

                        if (!ehLixo) {
                            const matchCNPJ = candidato.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
                            if (matchCNPJ) {
                                candidato = candidato.split(matchCNPJ[0])[0].trim();
                            }

                            if (candidato.length > 3) {
                                destinatario = candidato;
                                break;
                            }
                        }
                    }
                }
                break; 
            }
        }
    }

    // 🏷️ INTERCEPTADOR PARA DESTAK EMBALAGENS
    // O layout da Destak esmaga colunas, por isso aplicamos extração cirúrgica aqui.
    if (text.toUpperCase().includes('DESTAK')) {

        // Destinatário: nome vem na linha logo a seguir a "FATURA", colado ao CNPJ
        // Ex: "FATURA\nBONTEMPO SUPERMERCADO LTDA00.889.627/0001-45"
        const matchDestDestak = text.match(/FATURA[\r\n]+([A-Z][A-Z\s\.\-\&]+?)(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
        if (matchDestDestak) {
            destinatario = matchDestDestak[1].trim();
        }

        // Valor: a Linha 2 dos totais tem SEMPRE 5 campos zerados colados (Frete, Seguro,
        // Desconto, Outras, IPI) seguidos do Valor Total. Ex:
        //   Linha 1 (impostos): 2.500,00562,500,000,002.500,00  ← só 2 zeros, regex não dá match
        //   Linha 2 (totais):   0,000,000,000,000,002.500,00    ← exatamente 5 zeros, dá match
        // Usar {5} garante que não confundimos com a Linha 1 (máx. 2 zeros seguidos).
        const matchValorDestak = text.match(/(?:0,00){5}([1-9]\d{0,2}(?:\.\d{3})*,\d{2})/);
        if (matchValorDestak) {
            valor = matchValorDestak[1];
        }
    }

    destinatario = destinatario
        .replace(/NOME\/RAZ[ÃA]O SOCIAL/i, '')
        .replace(/CNPJ\/CPF/i, '')
        .trim();

    return { numero, valor, emitente, destinatario };
}

async function extrairDadosBoleto(text) {
    console.log("=== TEXTO BRUTO DO PDF (BOLETO) ===");
    console.log(text);
    console.log("===================================");
    // 🛡️ 1. INTERCEPTADOR EXCLUSIVO PARA "COMERCIAL PATY"
    if (text.toUpperCase().includes('COMERCIAL PATY')) {
        let valorFinal = "0,00";
        const matchMulta = text.match(/multa de R\$\s*(\d+,\d{2})/i);
        if (matchMulta) {
            const multa = parseFloat(matchMulta[1].replace(',', '.'));
            valorFinal = (multa * 50).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // 2. Busca Cirúrgica do Pagador (Radar de Linhas)
        let pagadorFinal = "Não identificado";
        const linhas = text.split(/\r?\n/);
        
        for (let i = 0; i < linhas.length; i++) {
            let linha = linhas[i].trim();
            let upper = linha.toUpperCase();
            
            // Ignora cabeçalhos que quebram a busca
            if (upper.includes('RECIBO')) continue;

            // CASO A: Nome grudado (ex: "PAGADOR REIS COMERCIO")
            if (upper.startsWith('PAGADOR ') || upper.startsWith('PAGADOR: ')) {
                let nome = linha.replace(/^PAGADOR[:\s]+/i, '').trim();
                nome = nome.split(/(?:RUA |AV |AVENIDA |CEP:|CPF|CNPJ|SACADOR|AUTENTICA)/i)[0].trim();
                
                if (nome.length > 3 && /[A-Z]{3,}/i.test(nome) && !nome.toUpperCase().includes('INSTRUÇÕES')) {
                    pagadorFinal = nome;
                }
            }
            // CASO B: "PAGADOR" sozinho, nome espalhado nas próximas 4 linhas
            else if (upper === 'PAGADOR' || upper === 'PAGADOR:' || upper === 'SACADO') {
                for (let j = 1; j <= 4; j++) {
                    if (i + j >= linhas.length) break;
                    let cand = linhas[i + j].trim();
                    let candUpper = cand.toUpperCase();
                    
                    // Pula linhas minúsculas, códigos de barras ou lixo do banco
                    if (cand.length < 3) continue;
                    if (cand.match(/\d{7,}/)) continue;
                    if (candUpper.match(/SACADOR|AVALISTA|CPF|CNPJ|ENDEREÇO|VENCIMENTO|AGENCIA|CÓDIGO|AUTENTICAÇÃO|RECIBO|INSTRUÇÕES|NOSSO/)) continue;
                    
                    // O primeiro texto válido que sobrevive aos filtros é o nome!
                    if (/[A-Z]{3,}/i.test(cand)) {
                        let nome = cand.split(/(?:RUA |AV |AVENIDA |CEP:|CPF|CNPJ)/i)[0].trim();
                        
                        // Ignora se apanhou o Beneficiário por engano na parte de cima do boleto
                        if (!nome.toUpperCase().includes('COMERCIAL PATY')) {
                            pagadorFinal = nome;
                        }
                        break; // Achou o nome, para o radar (mas o loop do documento continua até o rodapé)
                    }
                }
            }
        }

        let vencimentoFinal = "Indefinido";
        const matchVenc = text.match(/Vencimento[\s\S]{1,50}?(\d{2}\/\d{2}\/\d{4})/i);
        if (matchVenc) vencimentoFinal = matchVenc[1];

        let nfFinal = "SN";
        const matchNF = text.match(/NF:\s*(\d+)/i);
        if (matchNF) nfFinal = matchNF[1];

        return {
            pagador: pagadorFinal,
            beneficiario: "COMERCIAL PATY IMPORTACAO LTDA",
            vencimento: vencimentoFinal,
            valor: valorFinal,
            nf: nfFinal
        };
    }

    // ⚙️ 2. EXTRATOR GERAL (Para DESTAK e outros fornecedores)
    const linhas = text.split(/\r?\n/);
    
    let vencimento = "Indefinido";
    const regexData = /(\d{2}\/\d{2}\/\d{4})/;
    for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].match(/Vencimento/i) && i + 1 < linhas.length) {
            const match = linhas[i + 1].match(regexData);
            if (match) { vencimento = match[1]; break; }
        }
    }
    if (vencimento === "Indefinido") {
        const datas = text.match(/(\d{2}\/\d{2}\/\d{4})/g);
        if (datas) vencimento = datas[datas.length - 1];
    }

    let nf = "SN";
    const matchNf = text.match(/NF[:\s\.\-]*(\d+)/i);
    if (matchNf) nf = matchNf[1];

    let pagador = "Não identificado";
    // Prefixos reconhecidos para o campo do pagador em diferentes layouts de boleto
    const prefixosPagador = [
        /^Pagador\s*[:/]\s*/i,
        /^Pagador\s*\/\s*Avalista\s*[:/]?\s*/i,
        /^Nome\s+do\s+Pagador\s*[:/]?\s*/i,
        /^Sacado\s*[:/]?\s*/i,
        /^Sacador\s*\/?\s*Avalista\s*[:/]?\s*/i,
    ];
    for (let i = 0; i < linhas.length; i++) {
        let linha = linhas[i].trim();
        let achou = false;
        let conteudo = '';

        for (const prefixo of prefixosPagador) {
            if (linha.match(prefixo)) {
                conteudo = linha.replace(prefixo, '').split(/CNPJ|CPF/i)[0].trim();
                // Se o campo veio vazio na mesma linha, o nome está na linha seguinte
                if (conteudo.length < 3 && i + 1 < linhas.length) {
                    conteudo = linhas[i + 1].trim().split(/CNPJ|CPF/i)[0].trim();
                }
                achou = true;
                break;
            }
        }

        if (achou && conteudo.length > 3 && !conteudo.includes('(=)') && !/^\d{5,}/.test(conteudo)) {
            pagador = conteudo;
            break;
        }
    }

    let beneficiario = "Não identificado";
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (linha.toLowerCase().includes('beneficiário')) {
            if (i + 1 < linhas.length) {
                let candidato = linhas[i + 1].trim();
                if (!candidato.match(/Data|Emissão|Número|Espécie|Aceite/i) && candidato.length > 3) {
                    beneficiario = candidato.split(/CNPJ|CPF/i)[0].trim();
                    break;
                }
            }
        }
    }

    // Pega o maior valor no formato de moeda
    let valor = "0,00";
    const todosValores = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
    if (todosValores && todosValores.length > 0) {
        valor = todosValores.reduce((maior, atual) => {
            const parse = (v) => parseFloat(v.replace(/\./g, '').replace(',', '.'));
            return parse(atual) > parse(maior) ? atual : maior;
        });
    }

    return { pagador, beneficiario, vencimento, valor, nf };
}

// ========================================================
// 🍎 MAC OS: Automação de Lembretes (Corrigido)
// ========================================================
function criarLembreteMac(pagador, beneficiario, vencimento, nf) {
    if (!vencimento || !vencimento.includes('/')) return;
    const [dia, mes, ano] = vencimento.split('/');
    const nomeTitulo = (beneficiario && beneficiario !== "Não identificado") ? beneficiario : "Boleto";
    const titulo = `Pagar: ${nomeTitulo} - NF ${nf}`;
    const corpo = `Pagador Original: ${pagador}\nBoleto recebido via WhatsApp.`;

    // Escapa aspas no título e corpo para o AppleScript
    const tituloEscapado = titulo.replace(/"/g, '\\"');
    const corpoEscapado = corpo.replace(/"/g, '\\"');

    // Verifica se já existe um lembrete com o mesmo título
    const scriptVerificacao = `
        tell application "Reminders"
            if exists list "Contas" then
                set listaAlvo to list "Contas"
                set existeLembrete to exists (reminders of listaAlvo whose name is "${tituloEscapado}")
                return existeLembrete
            else
                return false
            end if
        end tell
    `;

    // Primeiro verifica se já existe
    exec(`osascript -e '${scriptVerificacao}'`, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Erro ao verificar lembrete: ${stderr}`);
            return;
        }

        // Se stdout contém "true", o lembrete já existe
        const jaExiste = stdout.trim().toLowerCase() === 'true';
        
        if (jaExiste) {
            console.log('⚠️ Lembrete duplicado, ignorando.');
            return;
        }

        // Se não existe, cria o lembrete
        const appleScript = `
            tell application "Reminders"
                if not (exists list "Contas") then
                    make new list with properties {name:"Contas"}
                end if
                set listaAlvo to list "Contas"
                set novaData to current date
                set day of novaData to ${dia}
                set month of novaData to ${mes}
                set year of novaData to ${ano}
                set time of novaData to 32400 
                make new reminder at end of listaAlvo with properties {name:"${tituloEscapado}", body:"${corpoEscapado}", due date:novaData}
            end tell
        `;

        exec(`osascript -e '${appleScript}'`, (error, stdout, stderr) => {
            if (error) console.error(`❌ Erro Lembrete: ${stderr}`);
            else console.log(`🍎 Lembrete criado.`);
        });
    });
}

// ========================================================
// 💾 GESTOR FINANCEIRO — Fase 1
// ========================================================

function lerDadosFinanceiros() {
    try {
        if (fs.existsSync(CAMINHO_DADOS_FINANCEIROS)) {
            const raw = fs.readFileSync(CAMINHO_DADOS_FINANCEIROS, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.log('⚠️ Erro ao ler dados_financeiros.json, criando novo:', err.message);
    }
    return { boletos: [], notas: [] };
}

function salvarDadosFinanceiros(dados) {
    try {
        fs.writeFileSync(CAMINHO_DADOS_FINANCEIROS, JSON.stringify(dados, null, 2), 'utf-8');
        backupDadosFinanceiros();
    } catch (err) {
        console.error('❌ Erro ao salvar dados_financeiros.json:', err.message);
    }
}

function guardarBoleto({ beneficiario, pagador, valor, vencimento, nf }) {
    const dados = lerDadosFinanceiros();
    const jaExiste = dados.boletos.some(b =>
        b.beneficiario === beneficiario && b.vencimento === vencimento && b.nf === nf
    );
    if (jaExiste) return;

    dados.boletos.push({
        tipo: 'BOLETO',
        beneficiario,
        pagador,
        valor,
        vencimento,
        nf,
        dataProcessamento: new Date().toISOString().split('T')[0],
        pago: false
    });
    salvarDadosFinanceiros(dados);
    console.log('💾 Boleto guardado no Gestor Financeiro.');
}

function guardarNota({ emitente, destinatario, valor, numero }) {
    const dados = lerDadosFinanceiros();
    const jaExiste = dados.notas.some(n => n.numero === numero && n.emitente === emitente);
    if (jaExiste) return;

    dados.notas.push({
        tipo: 'DANFE',
        emitente,
        destinatario,
        valor,
        numero,
        dataProcessamento: new Date().toISOString().split('T')[0]
    });
    salvarDadosFinanceiros(dados);
    console.log('💾 Nota Fiscal guardada no Gestor Financeiro.');
}

// ========================================================
// ☁️ O COFRE — Backup iCloud Drive (Fase 2)
// ========================================================

function copiarParaIcloud(caminhoOrigem, nomeArquivo, tipo) {
    try {
        const pastaDestino = tipo === 'DANFE' ? PASTA_ICLOUD_NOTAS : PASTA_ICLOUD_BOLETOS;
        const caminhoDestino = path.join(pastaDestino, nomeArquivo);
        fs.copyFileSync(caminhoOrigem, caminhoDestino);
        console.log(`☁️ Backup iCloud: ${nomeArquivo}`);
    } catch (err) {
        console.error(`⚠️ Falha no backup iCloud: ${err.message}`);
    }
}

function backupDadosFinanceiros() {
    try {
        if (fs.existsSync(CAMINHO_DADOS_FINANCEIROS)) {
            const destino = path.join(PASTA_ICLOUD, 'dados_financeiros.json');
            fs.copyFileSync(CAMINHO_DADOS_FINANCEIROS, destino);
            console.log('☁️ Backup iCloud: dados_financeiros.json');
        }
    } catch (err) {
        console.error(`⚠️ Falha no backup do JSON: ${err.message}`);
    }
}

function backupCompletoIcloud() {
    let totalCopiado = 0;

    const copiarPasta = (origem, destino) => {
        if (!fs.existsSync(origem)) return 0;
        if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });
        let count = 0;
        for (const arquivo of fs.readdirSync(origem)) {
            const caminhoOrig = path.join(origem, arquivo);
            if (fs.statSync(caminhoOrig).isFile() && arquivo.endsWith('.pdf')) {
                const caminhoDest = path.join(destino, arquivo);
                if (!fs.existsSync(caminhoDest)) {
                    fs.copyFileSync(caminhoOrig, caminhoDest);
                    count++;
                }
            }
        }
        return count;
    };

    totalCopiado += copiarPasta(path.join(DATA_DIR, 'boletos'), PASTA_ICLOUD_BOLETOS);
    totalCopiado += copiarPasta(path.join(DATA_DIR, 'notas'), PASTA_ICLOUD_NOTAS);
    backupDadosFinanceiros();

    return totalCopiado;
}

// ========================================================
// ⏰ ROTINAS AUTOMÁTICAS (node-cron)
// ========================================================

// 08:00 — Alerta de boletos a vencer hoje ou amanhã
cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Rotina 08:00: Verificando boletos a vencer...');
    try {
        const dados = lerDadosFinanceiros();
        if (!dados.boletos || dados.boletos.length === 0) return;

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const amanha = new Date(hoje);
        amanha.setDate(amanha.getDate() + 1);

        const formatarData = (d) =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const hojeStr = formatarData(hoje);
        const amanhaStr = formatarData(amanha);

        const urgentes = dados.boletos.filter(b =>
            !b.pago && (b.vencimento === hojeStr || b.vencimento === amanhaStr)
        );

        for (const boleto of urgentes) {
            const quando = boleto.vencimento === hojeStr ? 'HOJE' : 'AMANHÃ';
            await enviarTelegram(
                `⚠️ *Atenção!* O boleto de *${boleto.beneficiario}* (NF: ${boleto.nf || 'S/N'}) no valor de R$ ${boleto.valor} vence *${quando}* (${boleto.vencimento})!`
            );
            await delay(1000);
        }

        if (urgentes.length > 0) {
            console.log(`📨 ${urgentes.length} alerta(s) de vencimento enviado(s).`);
        } else {
            console.log('✅ Nenhum boleto a vencer hoje ou amanhã.');
        }
    } catch (err) {
        console.error('❌ Erro na rotina de alertas:', err.message);
    }
}, { timezone: 'America/Sao_Paulo' });

// 18:00 — Relatório diário
cron.schedule('0 18 * * *', async () => {
    console.log('⏰ Rotina 18:00: Gerando relatório diário...');
    try {
        const dados = lerDadosFinanceiros();
        const hojeStr = new Date().toISOString().split('T')[0];

        const boletosHoje = (dados.boletos || []).filter(b => b.dataProcessamento === hojeStr);
        const notasHoje = (dados.notas || []).filter(n => n.dataProcessamento === hojeStr);
        const totalDocs = boletosHoje.length + notasHoje.length;

        if (totalDocs === 0) {
            await enviarTelegram('📊 *Resumo do Dia:* Nenhum documento processado hoje.');
            return;
        }

        const parseValor = (v) => parseFloat((v || '0').replace(/\./g, '').replace(',', '.'));

        const totalBoletos = boletosHoje.reduce((sum, b) => sum + parseValor(b.valor), 0);
        const totalNotas = notasHoje.reduce((sum, n) => sum + parseValor(n.valor), 0);
        const totalMovimentado = totalBoletos + totalNotas;

        const formatarReais = (n) =>
            n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        let msg = `📊 *Resumo do Dia:* Hoje foram processados ${totalDocs} documento(s).\n`;
        msg += `💰 *Total movimentado:* R$ ${formatarReais(totalMovimentado)}\n`;
        if (boletosHoje.length > 0) msg += `  • ${boletosHoje.length} boleto(s): R$ ${formatarReais(totalBoletos)}\n`;
        if (notasHoje.length > 0) msg += `  • ${notasHoje.length} nota(s) fiscal(is): R$ ${formatarReais(totalNotas)}`;

        await enviarTelegram(msg);
        console.log('📨 Relatório diário enviado.');
    } catch (err) {
        console.error('❌ Erro na rotina de relatório:', err.message);
    }
}, { timezone: 'America/Sao_Paulo' });

// 02:00 — Backup completo para iCloud
cron.schedule('0 2 * * *', async () => {
    console.log('⏰ Rotina 02:00: Backup completo para iCloud...');
    try {
        const novos = backupCompletoIcloud();
        const msg = novos > 0
            ? `☁️ *Backup iCloud concluído!* ${novos} novo(s) PDF(s) copiado(s) + dados financeiros sincronizados.`
            : `☁️ *Backup iCloud concluído!* Tudo já estava sincronizado.`;
        await enviarTelegram(msg);
        console.log(`☁️ Backup completo: ${novos} novo(s) arquivo(s).`);
    } catch (err) {
        console.error('❌ Erro no backup iCloud:', err.message);
        await enviarTelegram(`❌ *Falha no backup iCloud:* ${err.message}`);
    }
}, { timezone: 'America/Sao_Paulo' });

console.log('⏰ Rotinas do Gestor Financeiro agendadas (02h backup / 08h alertas / 18h relatório).');

// ========================================================
// 🛑 GRACEFUL SHUTDOWN — Via Telegram
// ========================================================
let shutdownEmAndamento = false;

const desligarComAviso = async (sinal) => {
    if (shutdownEmAndamento) return;
    shutdownEmAndamento = true;

    console.log(`\n🔴 Sinal ${sinal} recebido. Avisando via Telegram...`);

    try {
        await enviarTelegram('🔴 *Menino do Alho:* Servidor desligado pelo Painel de Controlo.');
        console.log('✅ Aviso enviado via Telegram.');
    } catch (err) {
        console.error('⚠️ Falha ao enviar Telegram:', err.message);
    }

    try {
        if (sock) {
            sock.end(undefined);
            sock = null;
        }
        gravarStatusWP('desconectado');
    } catch {}

    process.exit(0);
};

process.removeAllListeners('SIGINT');
process.removeAllListeners('SIGTERM');

process.on('SIGINT', () => desligarComAviso('SIGINT'));
process.on('SIGTERM', () => desligarComAviso('SIGTERM'));

// ========================================================
// 🌐 SERVIDOR HTTP — Render exige que a aplicação ouça
//    na porta indicada por process.env.PORT em 0.0.0.0.
// ========================================================
const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health' || req.url === '/') {
        // Lê o status atual do WhatsApp para expor no health check
        let wpStatus = 'desconhecido';
        try {
            if (fs.existsSync(CAMINHO_WP_STATUS)) {
                const raw = fs.readFileSync(CAMINHO_WP_STATUS, 'utf-8');
                wpStatus = JSON.parse(raw).status || 'desconhecido';
            }
        } catch (_) { /* ignora */ }

        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', whatsapp: wpStatus, ts: Date.now() }));
    } else if (req.url === '/api/qr') {
        // QR Code para leitura remota (útil na interface do Render)
        try {
            if (fs.existsSync(CAMINHO_QR_ATUAL)) {
                const raw = fs.readFileSync(CAMINHO_QR_ATUAL, 'utf-8');
                const dados = JSON.parse(raw);
                const expirado = (Date.now() - (dados.ts || 0)) > 60000;
                res.writeHead(200);
                res.end(JSON.stringify({ qr: expirado ? null : dados.qr }));
            } else {
                res.writeHead(200);
                res.end(JSON.stringify({ qr: null }));
            }
        } catch (err) {
            res.writeHead(200);
            res.end(JSON.stringify({ qr: null, erro: err.message }));
        }
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ erro: 'Rota não encontrada' }));
    }
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor HTTP ativo em http://0.0.0.0:${PORT} (Render health check OK)`);
});
