# Bot de Boletos WhatsApp

Bot Node.js que monitora seu WhatsApp, detecta boletos PDF recebidos, extrai informações e cria lembretes automaticamente no app Lembretes do macOS.

## Funcionalidades

- ✅ Monitora mensagens recebidas no WhatsApp 24/7
- 📄 Detecta automaticamente arquivos PDF (boletos)
- 🔍 Extrai dados do boleto: Pagador, Vencimento e NF
- 📱 Cria lembretes no app Lembretes do macOS com data de vencimento
- 🔔 Envia notificações do sistema macOS
- 💬 Responde no WhatsApp confirmando o processamento

## Instalação

1. Instale as dependências:
```bash
npm install
```

## Como Usar

1. Inicie o bot:
```bash
npm start
```

2. Escaneie o QR Code exibido no terminal com o WhatsApp no seu celular

3. O bot ficará rodando e monitorando mensagens automaticamente

## Para Rodar 24h por Dia

Para manter o bot rodando continuamente no seu Mac Mini, você pode usar:

### Opção 1: PM2 (Recomendado)
```bash
npm install -g pm2
pm2 start index.js --name bot-boletos
pm2 save
pm2 startup
```

### Opção 2: Launchd (nativo do macOS)
Crie um arquivo `com.botboletos.plist` em `~/Library/LaunchAgents/`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.botboletos</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/jooo/Documento/bot-boletos/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/jooo/Documento/bot-boletos</string>
</dict>
</plist>
```

Depois execute:
```bash
launchctl load ~/Library/LaunchAgents/com.botboletos.plist
```

## Dependências

- `whatsapp-web.js` - Cliente WhatsApp Web
- `qrcode-terminal` - Exibe QR Code no terminal
- `pdf-parse` - Extrai texto de PDFs
- `child_process` - Executa comandos AppleScript (nativo do Node.js)

## Permissões Necessárias

O bot precisa de permissão para:
- Acessar o WhatsApp Web
- Criar lembretes no app Lembretes (primeira vez pode pedir permissão)
- Enviar notificações do sistema (primeira vez pode pedir permissão)

## Estrutura de Dados Extraídos

O bot extrai automaticamente:
- **Pagador**: Nome da empresa/pessoa que deve pagar
- **Vencimento**: Data no formato dd/mm/aaaa
- **NF**: Número da Nota Fiscal (quando disponível)

## Tratamento de Erros

O bot continua funcionando mesmo se:
- Não conseguir extrair todos os dados do PDF
- Houver erro ao criar lembrete
- Houver erro ao enviar notificação

Todos os erros são logados no console para debug.
