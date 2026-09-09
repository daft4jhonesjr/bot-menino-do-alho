#!/usr/bin/env node

// ============================================================
// 🔄 RECONSTRUIR — Sincroniza histórico de PDFs antigos
//    para o dados_financeiros.json
// ============================================================
// Uso: node reconstruir.js
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const pdf = require('pdf-parse');

const PASTA_ENVIADOS = path.join(__dirname, 'Enviados_para_Nuvem');
const CAMINHO_JSON = path.join(__dirname, 'dados_financeiros.json');
const PASTA_ICLOUD = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Backups_MeninoDoAlho');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Funções de extração (copiadas do index.js)
// ============================================================

function identificarTipoDocumento(text) {
    if (text.match(/DANFE|Nota Fiscal Eletrônica|Chave de acesso/i)) return 'DANFE';
    if (text.match(/Boleto|Pagador|Beneficiário|Nosso Número|Linha Digitável|341-7|237-2/i)) return 'BOLETO';
    return 'DESCONHECIDO';
}

function extrairDadosNF(text) {
    const lines = text.split(/\r\n|\n|\r/);
    let numero = 'SN', valor = '0,00', emitente = 'Desconhecido', destinatario = 'Desconhecido';

    const matchNum = text.match(/N[º°o]\.?\s*(\d+)/i);
    if (matchNum) numero = parseInt(matchNum[1], 10).toString();

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('VALOR TOTAL DA NOTA')) {
            let trecho = lines[i] + " " + (lines[i+1] || "");
            const matchValor = trecho.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
            if (matchValor) { valor = matchValor[0]; break; }
        }
    }

    for (let i = 0; i < 20; i++) {
        let l = lines[i] ? lines[i].trim() : '';
        if (l.length > 5 && !l.includes('DANFE') && !l.match(/^\d{2}\//)) {
            if (l.toUpperCase().includes('RECEBEMOS DE')) l = l.replace(/RECEBEMOS DE/i, '').trim();
            l = l.split(/OS PRODUTOS|OS SERVIÇOS|CONSTANTES|CNPJ|\(/i)[0].trim();
            if (l.length > 3 && !l.includes('DESTINATARIO')) { emitente = l; break; }
        }
    }
    if (emitente.length > 30) emitente = emitente.substring(0, 30).trim();

    for (let i = 0; i < lines.length; i++) {
        const linhaAtual = lines[i].toUpperCase();
        if (linhaAtual.includes('DESTINATARIO') || linhaAtual.includes('REMETENTE')) {
            for (let j = 1; j <= 12; j++) {
                if (i + j < lines.length) {
                    let candidato = lines[i + j].trim();
                    const cu = candidato.toUpperCase();
                    const ehLixo = candidato.length < 3 || cu.includes('NOME') || cu.includes('RAZÃO') ||
                        cu.includes('SOCIAL') || cu.includes('ENDEREÇO') || cu.includes('INSCRIÇÃO') ||
                        cu.includes('SUBST') || cu.includes('CNPJ') || cu.includes('CPF') ||
                        cu.includes('FONE') || cu.includes('DATA') || cu.includes('SAÍDA') ||
                        cu.includes('ENTRADA') || cu.includes('HORA') || cu.includes('BAIRRO') ||
                        cu.includes('CEP') || cu.includes('MUNICÍPIO') || cu.includes('FATURA') ||
                        cu.includes('DUPLICATA') || cu.includes('VENCIMENTO');
                    if (!ehLixo) {
                        const matchCNPJ = candidato.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
                        if (matchCNPJ) candidato = candidato.split(matchCNPJ[0])[0].trim();
                        if (candidato.length > 3) { destinatario = candidato; break; }
                    }
                }
            }
            break;
        }
    }

    return { numero, valor, emitente, destinatario };
}

function extrairDadosBoleto(text) {
    const lines = text.split(/\r\n|\n|\r/);

    let vencimento = null;
    const regexData = /(\d{2}\/\d{2}\/\d{4})/g;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/Vencimento/i) && i + 1 < lines.length) {
            const match = lines[i+1].match(regexData);
            if (match) vencimento = match[0];
        }
    }
    if (!vencimento) {
        const datas = text.match(regexData);
        if (datas) vencimento = datas[datas.length - 1];
    }

    let nf = 'SN';
    const matchNFDireto = text.match(/NF[:\s\.\-]*(\d+)/i);
    if (matchNFDireto) {
        nf = matchNFDireto[1];
    } else {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/N(úm|um)\.?\s*do\s*documento|Numero\s*Documento/i)) {
                if (i + 1 < lines.length) {
                    let nextLine = lines[i+1].trim();
                    if (!nextLine.includes('/') || nextLine.match(/\d+\/\d+/)) {
                        let numeros = nextLine.split('/')[0].match(/(\d+)/);
                        if (numeros && !nextLine.match(/\d{2}\/\d{2}\/\d{4}/)) { nf = numeros[1]; break; }
                    }
                }
            }
        }
    }

    let pagador = null;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.match(/^Pagador:/i)) {
            let conteudo = line.replace(/^Pagador:/i, '').trim().split(/CNPJ|CPF/i)[0].trim();
            if (conteudo.length > 3) { pagador = conteudo; break; }
        } else if (line.match(/^Pagador/i)) {
            for (let j = 1; j <= 5; j++) {
                if (i + j < lines.length) {
                    let proxima = lines[i + j].trim();
                    const ehLixo = proxima.length < 3 || proxima.match(/sacador|avalista|agencia|código|vencimento|número|banco|itaú|bradesco|autenticação|ficha/i);
                    if (!ehLixo) {
                        pagador = proxima.split(/CNPJ|CPF/i)[0].trim();
                        if (pagador.length > 3) { i = lines.length; break; }
                    }
                }
            }
        }
    }

    let beneficiario = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.toLowerCase() === 'beneficiário') {
            if (i + 1 < lines.length) {
                let candidato = lines[i+1].trim();
                const ehLixo = candidato.match(/Data|Emissão|Número|Espécie|Aceite|Processamento/i) || candidato.match(/RUA|AV\.|AVENIDA|ALAMEDA|CEP:|CENTRO|BAIRRO/i) || candidato.length < 3;
                if (!ehLixo) beneficiario = candidato.split(/CNPJ|CPF/i)[0].trim();
            }
        } else if (line.match(/^RECIBO DO PAGADOR/i)) {
            if (i + 1 < lines.length) {
                let candidato = lines[i+1].trim();
                const ehLixo = candidato.match(/Banco|Itaú|Bradesco|\d{3}-\d/i);
                if (!ehLixo && candidato.length > 3) {
                    beneficiario = candidato.split(/CNPJ|CPF/i)[0].trim();
                    break;
                }
            }
        }
    }

    let valor = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/Valor\s*(do)?\s*Documento|Valor\s*Cobrado/i)) {
            let trecho = lines[i] + " " + (lines[i+1] || "");
            const matchValor = trecho.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
            if (matchValor) { valor = matchValor[0]; break; }
        }
    }
    if (!valor) {
        const todosValores = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/g);
        if (todosValores && todosValores.length > 0) {
            valor = todosValores.reduce((maior, atual) => {
                const parse = (v) => parseFloat(v.replace(/\./g, '').replace(',', '.'));
                return parse(atual) > parse(maior) ? atual : maior;
            });
        }
    }

    return {
        pagador: pagador || "Não identificado",
        beneficiario: beneficiario || "Não identificado",
        vencimento: vencimento || "Indefinido",
        valor: valor || "0,00",
        nf: nf
    };
}

// ============================================================
// Funções do banco de dados
// ============================================================

function lerJSON() {
    try {
        if (fs.existsSync(CAMINHO_JSON)) return JSON.parse(fs.readFileSync(CAMINHO_JSON, 'utf-8'));
    } catch {}
    return { boletos: [], notas: [] };
}

function salvarJSON(dados) {
    fs.writeFileSync(CAMINHO_JSON, JSON.stringify(dados, null, 2), 'utf-8');
}

function extrairDataDoNome(nome) {
    const match = nome.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function jaExisteBoleto(dados, beneficiario, vencimento, nf) {
    return dados.boletos.some(b =>
        b.beneficiario === beneficiario && b.vencimento === vencimento && b.nf === nf
    );
}

function jaExisteNota(dados, numero, emitente) {
    return dados.notas.some(n => n.numero === numero && n.emitente === emitente);
}

// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

(async () => {
    console.log('');
    console.log('============================================================');
    console.log('  🔄 RECONSTRUIR — Sincronização do Histórico');
    console.log('============================================================');
    console.log('');

    if (!fs.existsSync(PASTA_ENVIADOS)) {
        console.log('❌ Pasta Enviados_para_Nuvem não encontrada!');
        process.exit(1);
    }

    const arquivos = fs.readdirSync(PASTA_ENVIADOS)
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .sort();

    console.log(`📂 Encontrados: ${arquivos.length} PDFs em Enviados_para_Nuvem`);

    const dados = lerJSON();
    const boletosAntes = dados.boletos.length;
    const notasAntes = dados.notas.length;
    console.log(`💾 Estado atual: ${boletosAntes} boleto(s) + ${notasAntes} nota(s) no JSON`);
    console.log('');

    let processados = 0;
    let novos = 0;
    let duplicados = 0;
    let erros = 0;
    let desconhecidos = 0;

    for (let i = 0; i < arquivos.length; i++) {
        const nome = arquivos[i];
        const caminho = path.join(PASTA_ENVIADOS, nome);
        const progresso = `[${i + 1}/${arquivos.length}]`;

        try {
            const buffer = fs.readFileSync(caminho);
            const pdfData = await pdf(buffer);
            const text = pdfData.text;

            const tipo = identificarTipoDocumento(text);

            if (tipo === 'BOLETO') {
                const d = extrairDadosBoleto(text);
                if (jaExisteBoleto(dados, d.beneficiario, d.vencimento, d.nf)) {
                    console.log(`${progresso} ⏭️  BOLETO duplicado: ${nome}`);
                    duplicados++;
                } else {
                    const dataProc = extrairDataDoNome(nome) || new Date().toISOString().split('T')[0];
                    dados.boletos.push({
                        tipo: 'BOLETO',
                        beneficiario: d.beneficiario,
                        pagador: d.pagador,
                        valor: d.valor,
                        vencimento: d.vencimento,
                        nf: d.nf,
                        dataProcessamento: dataProc,
                        pago: false,
                        ficheiro: nome
                    });
                    salvarJSON(dados);
                    novos++;
                    console.log(`${progresso} ✅ BOLETO novo: ${d.beneficiario} | R$ ${d.valor} | Venc: ${d.vencimento} | NF ${d.nf}`);
                }

            } else if (tipo === 'DANFE') {
                const d = extrairDadosNF(text);
                if (jaExisteNota(dados, d.numero, d.emitente)) {
                    console.log(`${progresso} ⏭️  DANFE duplicada: ${nome}`);
                    duplicados++;
                } else {
                    const dataProc = extrairDataDoNome(nome) || new Date().toISOString().split('T')[0];
                    dados.notas.push({
                        tipo: 'DANFE',
                        emitente: d.emitente,
                        destinatario: d.destinatario,
                        valor: d.valor,
                        numero: d.numero,
                        dataProcessamento: dataProc,
                        ficheiro: nome
                    });
                    salvarJSON(dados);
                    novos++;
                    console.log(`${progresso} ✅ DANFE nova: ${d.emitente} | NF ${d.numero} | R$ ${d.valor}`);
                }

            } else {
                console.log(`${progresso} ❓ DESCONHECIDO: ${nome}`);
                desconhecidos++;
            }

            processados++;
        } catch (err) {
            console.log(`${progresso} ❌ ERRO em ${nome}: ${err.message}`);
            erros++;
        }

        await delay(100);
    }

    // Backup para iCloud
    console.log('');
    console.log('☁️  Copiando JSON atualizado para o iCloud...');
    try {
        if (!fs.existsSync(PASTA_ICLOUD)) fs.mkdirSync(PASTA_ICLOUD, { recursive: true });
        fs.copyFileSync(CAMINHO_JSON, path.join(PASTA_ICLOUD, 'dados_financeiros.json'));
        console.log('☁️  Backup iCloud concluído!');
    } catch (err) {
        console.log(`⚠️  Falha no backup iCloud: ${err.message}`);
    }

    // Relatório final
    console.log('');
    console.log('============================================================');
    console.log('  📊 RELATÓRIO FINAL');
    console.log('============================================================');
    console.log(`  📄 PDFs analisados:   ${processados}`);
    console.log(`  ✅ Novos registos:    ${novos}`);
    console.log(`  ⏭️  Duplicados:       ${duplicados}`);
    console.log(`  ❓ Desconhecidos:     ${desconhecidos}`);
    console.log(`  ❌ Erros:             ${erros}`);
    console.log('  ------------------------------------------');
    console.log(`  💾 Boletos no JSON:   ${boletosAntes} → ${dados.boletos.length}`);
    console.log(`  💾 Notas no JSON:     ${notasAntes} → ${dados.notas.length}`);
    console.log('============================================================');
    console.log('');
})();
