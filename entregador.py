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

                            # ────────────────────────────────────────────────────────
                            # 🔍 PRÉ-DIAGNÓSTICO — impresso ANTES da chamada de rede
                            # ────────────────────────────────────────────────────────
                            token_presente = bool(os.environ.get("API_BOT_TOKEN"))
                            tamanho_arquivo = os.path.getsize(caminho_arquivo) if os.path.exists(caminho_arquivo) else -1
                            print("=" * 60)
                            print(f"☁️ [Entregador] >>> INICIANDO ENVIO PARA O SERVIDOR <<<")
                            print(f"☁️ [Entregador] Arquivo        : {nome_arquivo}")
                            print(f"☁️ [Entregador] Tipo           : {tipo_doc}")
                            print(f"☁️ [Entregador] URL alvo       : {ENDPOINT_UPLOAD}")
                            print(f"☁️ [Entregador] Var API_URL    (env): {os.environ.get('API_URL', '(não definida — usando fallback hardcoded)')}")
                            print(f"☁️ [Entregador] Token config.? (env): {token_presente} {'(via env)' if token_presente else '(usando fallback hardcoded)'}")
                            print(f"☁️ [Entregador] Arquivo existe       : {os.path.exists(caminho_arquivo)}")
                            print(f"☁️ [Entregador] Tamanho              : {tamanho_arquivo} bytes{' ⚠️ VAZIO!' if tamanho_arquivo == 0 else ''}")
                            print("=" * 60)
                            # ────────────────────────────────────────────────────────

                            # Prepara o FormData — MIME explícito para Flask aceitar
                            with open(caminho_arquivo, 'rb') as f:
                                files = {'file': (nome_arquivo, f, 'application/pdf')}
                                data = {'tipo': tipo_doc, 'nome': nome_arquivo}
                                # Autenticação via X-API-KEY (rota /api/bot/upload)
                                headers = {'X-API-KEY': API_BOT_TOKEN}

                                print(f"☁️ [Entregador] 🚀 Disparando POST para: {ENDPOINT_UPLOAD}")
                                resposta = requests.post(
                                    ENDPOINT_UPLOAD,
                                    files=files,
                                    data=data,
                                    headers=headers,
                                    verify=False,
                                    timeout=90,  # 90s — Render pode demorar a acordar
                                )

                            print(f"☁️ [Entregador] ✅ Resposta recebida! Status HTTP: {resposta.status_code}")
                            print(f"☁️ [Entregador] Corpo da resposta: {resposta.text[:500]}")

                            # Verifica se o upload foi bem-sucedido (200 ou 201)
                            if resposta.status_code in (200, 201):
                                try:
                                    dados = resposta.json()
                                    doc_id = dados.get('documento_id')
                                    if doc_id:
                                        print(f"✅ Documento registrado no banco com ID: {doc_id}")
                                    else:
                                        print(f"✅ Upload aceito pelo servidor, mas sem documento_id — verifique o banco no Render.")
                                except Exception:
                                    print(f"✅ Upload aceito (resposta não-JSON: {resposta.text[:200]})")

                                destino = os.path.join(PASTA_ENVIADOS, nome_arquivo)
                                shutil.move(caminho_arquivo, destino)
                                print(f"📂 Arquivo movido para 'Enviados_para_Nuvem'")

                            elif resposta.status_code == 400:
                                print(f"❌ ERRO 400 — Requisição inválida.")
                                print(f"📝 Resposta: {resposta.text}")
                                print("💡 MIME type rejeitado, campo 'tipo' errado ou arquivo corrompido.")
                                print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                            elif resposta.status_code == 403:
                                print(f"❌ ERRO 403 — Token inválido ou ausente.")
                                print(f"💡 API_BOT_TOKEN configurado no Render? Token (8 chars): {API_BOT_TOKEN[:8]}...")
                                print(f"💡 Endpoint usado: {ENDPOINT_UPLOAD}")
                                print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                            elif resposta.status_code == 404:
                                print(f"❌ ERRO 404 — Endpoint não encontrado: {ENDPOINT_UPLOAD}")
                                print("💡 Blueprint não registrado ou URL errada.")
                                print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                            elif resposta.status_code == 503:
                                print(f"❌ ERRO 503 — Servidor indisponível.")
                                print("💡 API_BOT_TOKEN pode estar ausente no ambiente do servidor.")
                                print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                            else:
                                print(f"❌ Status inesperado: {resposta.status_code}")
                                print(f"📝 Resposta: {resposta.text}")
                                print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                        except requests.exceptions.ConnectionError as e:
                            codigo = getattr(e, 'errno', None) or str(e)
                            print(f"❌ FALHA DE REDE — ConnectionError: {e}")
                            print(f"☁️ URL tentada: {ENDPOINT_UPLOAD}")
                            if 'ECONNREFUSED' in str(e) or 'Connection refused' in str(e):
                                print("💡 ECONNREFUSED — O servidor recusou a conexão. Está rodando na porta certa?")
                            elif 'ENOTFOUND' in str(e) or 'Name or service not known' in str(e) or 'getaddrinfo' in str(e):
                                print("💡 ENOTFOUND — Falha de DNS. Domínio não resolvido ou sem internet.")
                            elif 'ECONNRESET' in str(e) or 'Connection reset' in str(e):
                                print("💡 ECONNRESET — Conexão derrubada pelo servidor no meio da transferência.")
                            else:
                                print(f"💡 Código de rede: {codigo}")
                            print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                        except requests.exceptions.Timeout:
                            print(f"❌ FALHA DE REDE — Timeout (90s excedido) ao enviar: {nome_arquivo}")
                            print(f"☁️ URL tentada: {ENDPOINT_UPLOAD}")
                            print("💡 Servidor muito lento, arquivo muito grande, ou Render em cold start.")
                            print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                        except requests.exceptions.RequestException as e:
                            print(f"❌ FALHA DE REDE — RequestException: {e}")
                            print(f"☁️ URL tentada: {ENDPOINT_UPLOAD}")
                            print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

                        except Exception as e:
                            import traceback
                            print(f"❌ Erro inesperado: {e}")
                            print(traceback.format_exc())
                            print("⚠️ Arquivo NÃO movido. Será tentado novamente.")

        # Espera 5 segundos antes de verificar tudo de novo
        time.sleep(5)

if __name__ == "__main__":
    enviar_arquivos()
