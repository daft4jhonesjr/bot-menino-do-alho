const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Vamos pegar num boleto qualquer da sua pasta local para testar
const pastaBoletos = path.join(__dirname, 'boletos');
const arquivos = fs.existsSync(pastaBoletos) ? fs.readdirSync(pastaBoletos).filter(f => f.endsWith('.pdf')) : [];

if (arquivos.length === 0) {
    console.log('❌ Não encontrei nenhum PDF na pasta ./boletos para testar.');
    process.exit(1);
}

const arquivoTeste = arquivos[0];
const caminhoCompleto = path.join(pastaBoletos, arquivoTeste);

console.log(`📤 A iniciar envio do ficheiro: ${arquivoTeste}...`);

async function dispararMssil() {
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(caminhoCompleto));
        form.append('tipo', 'boleto');
        form.append('nome', arquivoTeste);

        console.log('⏳ A aguardar resposta do servidor (Render)...');

        const resposta = await axios.post('https://sistema-menino-do-alho.onrender.com/upload', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': 'SEGREDDO_DO_ALHO_2026'
            }
        });

        console.log('✅ SUCESSO! O servidor aceitou a encomenda.');
        console.log('Status HTTP:', resposta.status);
        console.log('Resposta do Servidor:', resposta.data);

    } catch (erro) {
        console.log('\n❌ FALHA NO UPLOAD!');
        if (erro.response) {
            // O servidor atendeu a porta, mas deu um murro (Erro 400, 401, 404, 500)
            console.log('Status do Erro:', erro.response.status);
            console.log('Mensagem do Servidor:', erro.response.data);
        } else if (erro.request) {
            // O servidor nem atendeu (offline, URL errada, timeout)
            console.log('O servidor não respondeu (provavelmente está offline ou a iniciar).');
        } else {
            console.log('Erro interno no Mac:', erro.message);
        }
    }
}

dispararMssil();
