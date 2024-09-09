# Interface de Contact Center

Esta é uma interface de usuário para um sistema de Contact Center, desenvolvida utilizando HTML, CSS e JavaScript.

## Funcionalidades

- Login de agente
- Gerenciamento de estado do agente (disponível/pausa)
- Manipulação de chamadas (atender, recusar, colocar em espera, encerrar)
- Associação de dados a chamadas
- Console de eventos em tempo real

## Como usar

1. Clone este repositório ou baixe os arquivos para o seu computador local.

2. Abra o arquivo `index.html` em um navegador web moderno. Você pode fazer isso de duas maneiras:
   - Dê um duplo clique no arquivo `index.html`, e ele será aberto no seu navegador padrão.
   - Arraste o arquivo `index.html` e solte-o em uma janela aberta do navegador.

3. Na tela de login, insira as seguintes informações:
   - Agente: Seu nome de usuário
   - Senha: Sua senha
   - IP do servidor: O endereço IP do servidor do Interact CTI
   - Porta: A porta do servidor (por padrão é 8582)

4. Clique em "Entrar" para fazer login no sistema.

5. Uma vez logado, você verá a interface principal com:
   - Controles de estado do agente (Disponível/Pausar)
   - Seção de chamadas (quando uma chamada estiver ativa)
   - Console de eventos

6. Use os botões e controles na interface para gerenciar seu estado e manipular chamadas.

7. O console de eventos mostrará informações em tempo real sobre suas ações e eventos do sistema.

## Requisitos

- Um navegador web moderno (Chrome, Firefox, Safari, Edge)
- Conexão com o servidor do Contact Center

## Notas

- Certifique-se de que o servidor do Contact Center esteja configurado e acessível antes de tentar fazer login.
- Esta interface é apenas o front-end e requer um back-end correspondente para funcionar corretamente.
