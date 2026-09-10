import os
import time
import random
import requests
import shutil
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- CONFIGURAÇÕES ---
# O caminho da pasta principal
PASTA_RAIZ = "/Users/jooo/Documentos/bot-boletos"

# As pastas onde o Robô do Zap guarda os arquivos
PASTAS_PARA_OLHAR = ['boletos', 'notas']

# Onde guardar depois de enviar com sucesso
PASTA_ENVIADOS = os.path.join(PASTA_RAIZ, "Enviados_para_Nuvem")

# ── URL base e token do servidor Flask ────────────────────────────────────────
# IMPORTANTE: defina essas variáveis no ambiente (ex: .env ou Render Dashboard)
# para não depender de valores hardcoded.
API_URL       = os.environ.get("API_URL",        "https://sistema-menino-do-alho.onrender.com")
API_BOT_TOKEN = os.environ.get("API_BOT_TOKEN",  "ALHO_BOT_SUPER_SECRETO_2026_XYZ")

# Endpoint correto para o bot externo (autentica via X-API-KEY)
ENDPOINT_UPLOAD = f"{API_URL}/api/bot/upload"

print(f"🔧 [Entregador] API_URL: {API_URL}")
print(f"🔧 [Entregador] Endpoint: {ENDPOINT_UPLOAD}")
# ─────────────────────────────────────────────────────────────────────────────

def enviar_arquivos():
    # Garante que a pasta de enviados existe
    if not os.path.exists(PASTA_ENVIADOS):
        os.makedirs(PASTA_ENVIADOS)
        print(f"📁 Pasta 'Enviados_para_Nuvem' criada.")

    print(f"👀 Vigiando as pastas: {PASTAS_PARA_OLHAR}")
    print("📤 Enviando arquivos para a nuvem... (Pressione Ctrl+C para parar)")

    while True:
        # Loop para olhar dentro de cada pasta (boletos, notas)
        for pasta in PASTAS_PARA_OLHAR:
            caminho_completo_pasta = os.path.join(PASTA_RAIZ, pasta)
            
            # Só olha se a pasta existir
            if os.path.exists(caminho_completo_pasta):
                arquivos = os.listdir(caminho_completo_pasta)
                
                for nome_arquivo in arquivos:
                    # Ignora a subpasta 'originais'
                    if nome_arquivo == 'originais':
                        continue
                    
                    # Verifica se é PDF ou XML
                    if nome_arquivo.lower().endswith(('.pdf', '.xml')):
                        caminho_arquivo = os.path.join(caminho_completo_pasta, nome_arquivo)
                        
                        # Ignora se já está na pasta de enviados
                        if caminho_arquivo.startswith(PASTA_ENVIADOS):
                            continue
                        
                        print(f"\n📄 Arquivo encontrado em '{pasta}': {nome_arquivo}")
                        print("🚀 Enviando para o servidor...")

                        # --- SIMULAÇÃO HUMANA ---
                        tempo_espera = random.uniform(5, 12)
                        print(f"⏳ Simulando comportamento humano... aguardando {tempo_espera:.1f}s")
                        time.sleep(tempo_espera)
                        # ------------------------

                        try:
                            # Determina o tipo baseado na pasta de origem
                            tipo_doc = 'nfe' if pasta == 'notas' else 'boleto'
                            
                            print(f"☁️ [Entregador] Enviando para: {ENDPOINT_UPLOAD}")
                            print(f"☁️ [Entregador] Tipo: {tipo_doc} | Arquivo: {nome_arquivo}")

                            # Prepara o FormData — MIME explícito para Flask aceitar
                            with open(caminho_arquivo, 'rb') as f:
                                files = {'file': (nome_arquivo, f, 'application/pdf')}
                                data = {'tipo': tipo_doc, 'nome': nome_arquivo}
                                # Autenticação via X-API-KEY (rota /api/bot/upload)
                                headers = {
                                    'X-API-KEY': API_BOT_TOKEN,
                                }
                                
                                # Envia para o servidor
                                resposta = requests.post(
                                    ENDPOINT_UPLOAD,
                                    files=files, 
                                    data=data, 
                                    headers=headers, 
                                    verify=False, 
                                    timeout=90  # 90s — Render pode demorar a acordar
                                )

                            print(f"☁️ [Entregador] Status HTTP: {resposta.status_code}")
                            print(f"☁️ [Entregador] Resposta: {resposta.text[:500]}")

                            # Verifica se o upload foi bem-sucedido (200 ou 201)
                            if resposta.status_code in (200, 201):
                                try:
                                    dados = resposta.json()
                                    doc_id = dados.get('documento_id')
                                    if doc_id:
                                        print(f"✅ Upload bem-sucedido! Documento criado no banco com ID: {doc_id}")
                                    else:
                                        print(f"✅ Upload bem-sucedido! (servidor não retornou documento_id — verifique o banco)")
                                except Exception:
                                    print(f"✅ Upload bem-sucedido! (resposta não-JSON: {resposta.text[:200]})")
                                
                                # Move para a pasta de enviados apenas se deu sucesso
                                destino = os.path.join(PASTA_ENVIADOS, nome_arquivo)
                                shutil.move(caminho_arquivo, destino)
                                print(f"📂 Arquivo movido para 'Enviados_para_Nuvem'")
                            
                            elif resposta.status_code == 403:
                                print(f"❌ ERRO 403: Token inválido ou ausente.")
                                print(f"💡 Verifique se API_BOT_TOKEN está configurado no Render com o valor correto.")
                                print(f"💡 Token usado: {API_BOT_TOKEN[:8]}... | Endpoint: {ENDPOINT_UPLOAD}")
                                print("⚠️ Arquivo não foi movido. Tentará novamente na próxima verificação.")

                            elif resposta.status_code == 400:
                                print(f"❌ ERRO 400: Requisição inválida.")
                                print(f"📝 Resposta: {resposta.text}")
                                print("💡 Verifique o tipo de arquivo e o campo 'tipo' (deve ser 'boleto' ou 'nfe').")
                                print("⚠️ Arquivo não foi movido. Tentará novamente na próxima verificação.")
                            
                            else:
                                print(f"❌ Erro no servidor. Status: {resposta.status_code}")
                                print(f"📝 Resposta: {resposta.text}")
                                print("⚠️ Arquivo não foi movido. Tentará novamente na próxima verificação.")

                        except requests.exceptions.Timeout:
                            print(f"⏱️ Timeout ao enviar {nome_arquivo}. Tentará novamente.")
                        
                        except requests.exceptions.RequestException as e:
                            print(f"❌ Erro de conexão: {e}")
                            print("⚠️ Arquivo não foi movido. Tentará novamente na próxima verificação.")
                        
                        except Exception as e:
                            print(f"❌ Erro inesperado: {e}")
                            print("⚠️ Arquivo não foi movido. Tentará novamente na próxima verificação.")

        # Espera 5 segundos antes de verificar tudo de novo
        time.sleep(5)

if __name__ == "__main__":
    enviar_arquivos()
