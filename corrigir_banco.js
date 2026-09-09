const fs = require('fs');
const path = require('path');

const CAMINHO_DADOS = path.join(__dirname, 'dados_financeiros.json');
const CAMINHO_BACKUP = path.join(__dirname, 'dados_financeiros_backup.json');

console.log('🏥 Iniciando a cirurgia nos dados financeiros...');

try {
    // 1. Criar um backup por segurança
    fs.copyFileSync(CAMINHO_DADOS, CAMINHO_BACKUP);
    console.log('✅ Backup de segurança criado com sucesso.');

    // 2. Ler os dados
    const dados = JSON.parse(fs.readFileSync(CAMINHO_DADOS, 'utf-8'));
    let corrigidos = 0;

    // 3. Varrer os boletos
    dados.boletos.forEach(boleto => {
        if (boleto.beneficiario && boleto.beneficiario.toUpperCase().includes('PATY')) {
            // Converte "32,00" ou "1.600,00" para número (32.00 / 1600.00)
            let valorNumerico = parseFloat(boleto.valor.replace(/\./g, '').replace(',', '.'));

            // Se o valor for muito baixo (menor que 200), temos certeza de que é a multa errada
            if (valorNumerico > 0 && valorNumerico < 200) {
                let valorReal = valorNumerico * 50;
                
                // Formata de volta para o padrão brasileiro "1.600,00"
                boleto.valor = valorReal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                
                console.log(`🔧 Boleto NF ${boleto.nf} corrigido: De R$ ${valorNumerico.toFixed(2)} para R$ ${boleto.valor}`);
                corrigidos++;
            }
        }
    });

    // 4. Salvar os dados curados
    fs.writeFileSync(CAMINHO_DADOS, JSON.stringify(dados, null, 2), 'utf-8');
    
    console.log(`\n🎉 Cirurgia concluída! ${corrigidos} boletos da Comercial Paty foram corrigidos.`);
    console.log('Pode recarregar o seu Painel no navegador!');

} catch (erro) {
    console.error('❌ Ocorreu um erro:', erro.message);
}
