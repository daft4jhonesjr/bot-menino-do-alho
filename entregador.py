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

# Dados do Site

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
                            
                            # Prepara o FormData
                            with open(caminho_arquivo, 'rb') as f:
                                files = {'file': (nome_arquivo, f, 'application/pdf')}
                                data = {'tipo': tipo_doc, 'nome': nome_arquivo}
                                url = 'https://sistema-menino-do-alho.onrender.com/upload'
                                headers = {
                                    'Authorization': 'ALHO_BOT_SUPER_SECRETO_2026_XYZ',
                                    'X-API-KEY': 'ALHO_BOT_SUPER_SECRETO_2026_XYZ'
                                }
                                
                                # Envia para o servidor
                                resposta = requests.post(
                                    url,
                                    files=files, 
                                    data=data, 
                                    headers=headers, 
                                    verify=False, 
                                    timeout=60
                                )

                            # Verifica se o upload foi bem-sucedido (200 OK)
                            if resposta.status_code == 200:
                                print("✅ Upload bem-sucedido!")
                                
                                # Move para a pasta de enviados apenas se deu sucesso
                                destino = os.path.join(PASTA_ENVIADOS, nome_arquivo)
                                shutil.move(caminho_arquivo, destino)
                                print(f"📂 Arquivo movido para 'Enviados_para_Nuvem'")
                            
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
