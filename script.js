let agent, baseUrl, eventSource, currentState, pauseReasons;

document.addEventListener('DOMContentLoaded', function() {
    // Não é necessário definir os estilos aqui, pois já estão definidos no HTML
});

document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    agent = document.getElementById('agent').value;
    const password = document.getElementById('password').value;
    const baseIp = document.getElementById('base-ip').value;
    const basePort = document.getElementById('base-port').value || '8582';

    if (!baseIp || baseIp === 'undefined') {
        logEvent('Operação cancelada: IP do servidor não fornecido', 'error');
        return;
    }

    baseUrl = `http://${baseIp}:${basePort}/interact_cti/v1.0`;

    try {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('main-container').style.display = 'flex';

        // Adicionar os botões de reiniciar e sair
        const topButtonsContainer = document.createElement('div');
        topButtonsContainer.id = 'top-buttons-container';
        topButtonsContainer.innerHTML = `
            <button id="reset-connections-btn" class="btn-secondary"><i class="fas fa-sync"></i> Reiniciar</button>
            <button id="logout-btn" class="btn-secondary"><i class="fas fa-sign-out-alt"></i> Sair</button>
        `;
        document.getElementById('main-container').insertBefore(topButtonsContainer, document.getElementById('main-container').firstChild);

        // Adicionar event listeners para os novos botões
        document.getElementById('reset-connections-btn').addEventListener('click', resetConnections);
        document.getElementById('logout-btn').addEventListener('click', logout);

        document.getElementById('agent-name').textContent = agent;

        // Iniciar a conexão com o servidor de eventos e se inscrever
        await connectAndSubscribe();
        createVisualTimer();
    } catch (error) {
        console.error('Erro detalhado:', error);
        logEvent('Erro ao fazer login: ' + error.message, 'error');
    }
});


async function logout() {
    try {
        // Preparar os dados da requisição
        const logoutBody = { agent: agent };
        
        // Registrar a requisição antes de enviá-la
        logApiRequest('POST', `${baseUrl}/agent/logout`, logoutBody);

        // Realizar o comando de logout
        const logoutResponse = await fetch(`${baseUrl}/agent/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(logoutBody)
        });
        const logoutData = await logoutResponse.json();
        
        // Registrar a resposta
        logApiResponse(logoutResponse.status, logoutData);

        if (!logoutResponse.ok) {
            throw new Error('Falha ao realizar logout');
        }

        // Obter todas as assinaturas ativas
        const subscriptionsResponse = await fetch(`${baseUrl}/agent/monitor/get_subscriptions?format=json`);
        const subscriptionsData = await subscriptionsResponse.json();

        if (subscriptionsData.response && subscriptionsData.response.subscriptions) {
            const subscriptions = subscriptionsData.response.subscriptions;

            // Fechar o canal e cancelar a assinatura
            for (const subscription of subscriptions) {
                await fetch(`${baseUrl}/agent/monitor/close_channel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel_id: subscription.channel_id })
                });

                await fetch(`${baseUrl}/agent/monitor/unsubscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: subscription.id })
                });
            }
        }

        document.getElementById('main-container').style.display = 'none';
        document.getElementById('login-container').style.display = 'flex';

        // Limpar dados e fechar conexão
        if (eventSource) {
            eventSource.close();
        }
        agent = null;
        baseUrl = null;
        document.getElementById('login-form').reset();
        document.getElementById('log-container').innerHTML = '';
        pauseMenuInitialized = false; // Resetar o estado de inicialização do menu de pausas

        // Exibir popup de logout bem-sucedido
        showPopup('Logout realizado com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao realizar logout:', error);
        logEvent('Erro ao realizar logout: ' + error.message, 'error');
        showPopup('Erro ao realizar logout. Por favor, tente novamente.', 'error');
    }
}

function showPopup(message, type) {
    const popup = document.createElement('div');
    popup.className = `popup ${type}`;
    popup.textContent = message;
    document.body.appendChild(popup);

    setTimeout(() => {
        popup.remove();
    }, 3000);
}

async function connectAndSubscribe() {
    try {
        // Obter lista de subscrições existentes
        logApiRequest('GET', `${baseUrl}/agent/monitor/get_subscriptions?format=json`);
        const subscriptionsResponse = await fetch(`${baseUrl}/agent/monitor/get_subscriptions?format=json`);
        const subscriptionsData = await subscriptionsResponse.json();
        logApiResponse(subscriptionsResponse.status, subscriptionsData);

        console.log('Subscriptions data:', subscriptionsData);

        if (!subscriptionsResponse.ok) {
            throw new Error('Falha ao obter lista de subscrições');
        }

        // Encontrar um ID de canal disponível entre 1 e 9999
        let channelId;
        const usedChannelIds = new Set(subscriptionsData.response && subscriptionsData.response.subscriptions 
            ? subscriptionsData.response.subscriptions.map(sub => sub.channel_id)
            : []);
        do {
            channelId = Math.floor(Math.random() * 9999) + 1;
        } while (usedChannelIds.has(channelId));

        console.log('Channel ID:', channelId);

        const subscribeBody = {
            subscription: {
                agents: [agent],
                events: [
                    "on_login", 
                    "on_logout", 
                    "on_state_change",
                    "on_call_receive",
                    "on_call_accept",
                    "on_call_release",
                    "on_call_hold",
                    "on_call_end",
                    "on_call_associated_data"
                ],
                expires: 3600,
                channel_id: channelId,
                agent_control: true
            }
        };
        logApiRequest('POST', `${baseUrl}/agent/monitor/subscribe`, subscribeBody);

        const subscribeResponse = await fetch(`${baseUrl}/agent/monitor/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(subscribeBody)
        });

        const subscribeData = await subscribeResponse.json();
        logApiResponse(subscribeResponse.status, subscribeData);

        if (!subscribeResponse.ok) {
            throw new Error('Falha ao se inscrever nos eventos');
        }

        console.log('Inscrição bem-sucedida:', subscribeData);

        // Log da requisição de abertura de canal
        logApiRequest('GET', `${baseUrl}/agent/monitor/open_channel?channel_id=${channelId}&format=json`);

        eventSource = new EventSource(`${baseUrl}/agent/monitor/open_channel?channel_id=${channelId}&format=json`);

        // Log da resposta de abertura de canal
        logEvent('Canal aberto', 'channel', { channel_id: channelId });

        const events = ['message', 'on_state_change', 'on_login', 'on_logout',"on_call_receive","on_call_accept","on_call_release","on_call_hold","on_call_end","on_call_associated_data"];

        events.forEach(event => {
            eventSource.addEventListener(event, handleEvent);
        });

        eventSource.onerror = handleError;
        eventSource.onopen = handleOpen;

        // Realizar login do agente
        await loginAgent();

        // Inicializar o menu de pausas
        initializePauseMenu();

        // Adicionar event listeners para os botões de estado
        document.getElementById('available-btn').addEventListener('click', setAvailableState);
        document.getElementById('pause-btn').addEventListener('click', showPauseMenu);
        document.getElementById('confirm-pause-btn').addEventListener('click', setPauseState);

    } catch (error) {
        console.error('Erro ao conectar e se inscrever:', error);
        logEvent('Erro ao conectar com o servidor de eventos: ' + error.message, 'error');
    }
}

async function loginAgent() {
    try {
        const password = document.getElementById('password').value;
        const loginBody = {
            agent: agent,
            password: password
        };
        logApiRequest('POST', `${baseUrl}/agent/login`, loginBody);

        const loginResponse = await fetch(`${baseUrl}/agent/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginBody)
        });

        const loginData = await loginResponse.json();
        logApiResponse(loginResponse.status, loginData);

        if (!loginResponse.ok) {
            throw new Error('Falha ao realizar login do agente');
        }

        console.log('Login bem-sucedido:', loginData);

        if (loginData.response && loginData.response.status === 'ok') {
            logEvent('Login realizado com sucesso', 'success');
            
            // Buscar a lista de pausas
            await fetchPauseTypes();
            
            // Definir o estado do agente como disponível (ID 2) após o login bem-sucedido
            await setAgentState(2);
        } else {
            throw new Error('Login falhou: ' + (loginData.response ? loginData.response.status : 'Resposta inválida'));
        }
    } catch (error) {
        console.error('Erro ao realizar login do agente:', error);
        logEvent('Erro ao realizar login do agente: ' + error.message, 'error');
        throw error; // Propagar o erro para interromper o processo de conexão
    }
}

async function fetchPauseTypes() {
    try {
        logApiRequest('GET', `${baseUrl}/agent/get_pause_type_list?format=json&trigger=manual`);
        const response = await fetch(`${baseUrl}/agent/get_pause_type_list?format=json&trigger=manual`);
        const data = await response.json();
        logApiResponse(response.status, data);

        if (!response.ok) {
            throw new Error('Falha ao buscar tipos de pausa');
        }

        if (data.response && data.response.pauses) {
            pauseReasons = data.response.pauses;
            initializePauseMenu();
        } else {
            throw new Error('Resposta inválida ao buscar tipos de pausa');
        }
    } catch (error) {
        console.error('Erro ao buscar tipos de pausa:', error);
        logEvent('Erro ao buscar tipos de pausa: ' + error.message, 'error');
    }
}

function handleEvent(event) {
    console.log('Evento recebido:', event);

    try {
        const eventData = JSON.parse(event.data);
        
        let eventType = event.type;
        let eventName = getEventName(eventType);
        let icon = getIconForType(eventType);
        
        if (eventType === 'on_state_change') {
            const statusText = eventData.pause_name ? `${eventData.state} - ${eventData.pause_name}` : eventData.state;
            logEvent(`${eventName} (${eventType}) - ${statusText}`, 'channel', eventData);
        } else {
            logEvent(`${eventName} (${eventType})`, 'channel', eventData);
        }

        switch (event.type) {
            case 'on_state_change':
                updateAgentState(eventData.state, eventData.pause_name);
                break;
            case 'on_login':
            case 'on_logout':
                // Esses eventos já são tratados pela função logEvent
                break;
            case 'message':
                // Heartbeat, atualizar o indicador de status
                updateConnectionStatus();
                break;
            case 'on_call_receive':
                handleCallReceive(eventData);
                break;
            case 'on_call_accept':
                handleCallAccept(eventData);
                break;
            case 'on_call_release':
                handleCallRelease(eventData);
                break;
            case 'on_call_hold':
                handleCallHold(eventData);
                break;
            case 'on_call_end':
                handleCallEnd(eventData);
                break;
            case 'on_call_associated_data':
                handleCallAssociatedData(eventData);
                break;
        }
    } catch (error) {
        console.error('Erro ao processar evento:', error);
        logEvent('Erro ao processar evento', 'error', { message: error.message });
    }
}

function handleCallReceive(eventData) {
    logEvent('Chamada recebida', 'call', eventData);
    const callSection = document.getElementById('call-section');
    const callInfo = document.getElementById('call-info');
    const callButtons = document.getElementById('call-buttons');
    const callData = document.getElementById('call-data');

    callSection.classList.remove('hidden');
    callSection.classList.add('ringing');
    callInfo.innerHTML = `
        <i class="fas fa-phone-volume"></i>
        <div>
            <p>Recebendo chamada</p>
            <p><strong>${eventData.interlocutor}</strong></p>
        </div>
    `;
    callButtons.innerHTML = `
        <button id="refuse-call-btn"><i class="fas fa-phone-slash"></i> Recusar Chamada</button>
    `;
    callData.style.display = 'none'; // Oculta completamente o campo de associação de dados

    document.getElementById('refuse-call-btn').addEventListener('click', () => refuseCall(eventData.call_id));
    
    // Armazenar o ID da chamada atual
    currentCallId = eventData.call_id;
}

function handleCallAccept(eventData) {
    logEvent('Chamada aceita', 'call', eventData);
    const callSection = document.getElementById('call-section');
    const callInfo = document.getElementById('call-info');
    const callButtons = document.getElementById('call-buttons');
    const callData = document.getElementById('call-data');

    callSection.classList.remove('ringing');
    callInfo.innerHTML = `
        <i class="fas fa-phone"></i>
        <div>
            <p>Em chamada com:</p>
            <p><strong>${eventData.interlocutor}</strong></p>
        </div>
    `;
    callButtons.innerHTML = `
        <button id="hold-call-btn"><i class="fas fa-pause"></i> Colocar em Espera</button>
        <button id="end-call-btn"><i class="fas fa-phone-slash"></i> Encerrar Chamada</button>
    `;
    callData.style.display = 'flex'; // Mostra o campo de associação de dados

    updateHoldButton(false);
    document.getElementById('end-call-btn').addEventListener('click', () => endCall(eventData.call_id));
    
    // Armazenar o ID da chamada atual
    currentCallId = eventData.call_id;

    // Configurar o botão de associar dados
    setupAssociateDataButton();
}

function handleCallRelease(eventData) {
    logEvent('Chamada liberada', 'call', eventData);
    // Implementar lógica para classificação ou pós-atendimento, se necessário
}

function handleCallHold(eventData) {
    logEvent('Chamada em espera', 'call', eventData);
    updateHoldButton(true);
}

function updateHoldButton(isOnHold) {
    const holdButton = document.getElementById('hold-call-btn');
    if (holdButton) {
        if (isOnHold) {
            holdButton.innerHTML = '<i class="fas fa-play"></i> Retirar da Espera';
            holdButton.onclick = () => retrieveCall(getCurrentCallId());
        } else {
            holdButton.innerHTML = '<i class="fas fa-pause"></i> Colocar em Espera';
            holdButton.onclick = () => holdCall(getCurrentCallId());
        }
    }
}

function handleCallEnd(eventData) {
    logEvent('Chamada encerrada', 'call', eventData);
    const callSection = document.getElementById('call-section');
    callSection.classList.add('hidden');
    callSection.classList.remove('ringing');
    callSection.innerHTML = `
        <div id="call-info"></div>
        <div id="call-buttons"></div>
        <div id="call-data">
            <input type="text" id="associated-data" maxlength="100" placeholder="Dados associados (max 100 caracteres)">
            <button id="associate-data-btn">Associar Dados</button>
        </div>
    `;
    document.getElementById('associated-data').value = '';
}

function handleCallAssociatedData(eventData) {
    logEvent('Dados associados à chamada', 'call', eventData);
    // Atualizar a interface com os novos dados associados, se necessário
}

async function refuseCall(callId) {
    try {
        const requestBody = { call_id: callId, agent: agent };
        logApiRequest('POST', `${baseUrl}/agent/call_terminate`, requestBody);
        const response = await fetch(`${baseUrl}/agent/call_terminate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        logApiResponse(response.status, data);
        if (data.response && data.response.status === 'ok') {
            logEvent('Chamada recusada com sucesso', 'success');
            handleCallEnd({ call_id: callId });
        } else {
            throw new Error('Falha ao recusar chamada');
        }
    } catch (error) {
        console.error('Erro ao recusar chamada:', error);
        logEvent('Erro ao recusar chamada: ' + error.message, 'error');
    }
}

async function holdCall(callId) {
    try {
        const requestBody = { call_id: callId, agent: agent };
        logApiRequest('POST', `${baseUrl}/agent/call_hold`, requestBody);
        const response = await fetch(`${baseUrl}/agent/call_hold`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        logApiResponse(response.status, data);
        if (data.response && data.response.status === 'ok') {
            logEvent('Chamada colocada em espera com sucesso', 'success');
            updateHoldButton(true);
        } else {
            throw new Error('Falha ao colocar chamada em espera');
        }
    } catch (error) {
        console.error('Erro ao colocar chamada em espera:', error);
        logEvent('Erro ao colocar chamada em espera: ' + error.message, 'error');
    }
}

async function retrieveCall(callId) {
    try {
        const requestBody = { call_id: callId, agent: agent };
        logApiRequest('POST', `${baseUrl}/agent/call_retrieve`, requestBody);
        const response = await fetch(`${baseUrl}/agent/call_retrieve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        logApiResponse(response.status, data);
        if (data.response && data.response.status === 'ok') {
            logEvent('Chamada retirada da espera com sucesso', 'success');
            updateHoldButton(false);
        } else {
            throw new Error('Falha ao retirar chamada da espera');
        }
    } catch (error) {
        console.error('Erro ao retirar chamada da espera:', error);
        logEvent('Erro ao retirar chamada da espera: ' + error.message, 'error');
    }
}

async function endCall(callId) {
    try {
        const requestBody = { call_id: callId, agent: agent };
        logApiRequest('POST', `${baseUrl}/agent/call_terminate`, requestBody);
        const response = await fetch(`${baseUrl}/agent/call_terminate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        logApiResponse(response.status, data);
        if (data.response && data.response.status === 'ok') {
            logEvent('Chamada encerrada com sucesso', 'success');
            handleCallEnd({ call_id: callId });
        } else {
            throw new Error('Falha ao encerrar chamada');
        }
    } catch (error) {
        console.error('Erro ao encerrar chamada:', error);
        logEvent('Erro ao encerrar chamada: ' + error.message, 'error');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // ... (código existente)

    // Remova esta linha, pois o botão ainda não existe neste momento
    // document.getElementById('associate-data-btn').addEventListener('click', associateData);
});

// Adicione esta nova função para configurar o botão de associar dados
function setupAssociateDataButton() {
    const associateDataBtn = document.getElementById('associate-data-btn');
    if (associateDataBtn) {
        associateDataBtn.addEventListener('click', associateData);
    } else {
        console.error('Botão de associar dados não encontrado');
    }
}

async function associateData() {
    const associatedData = document.getElementById('associated-data').value;
    const callId = getCurrentCallId(); // Implementar esta função para obter o ID da chamada atual

    if (!callId) {
        logEvent('Nenhuma chamada ativa para associar dados', 'error');
        return;
    }

    try {
        const requestBody = { call_id: callId, from: agent, data: associatedData };
        logApiRequest('POST', `${baseUrl}/agent/call_associate_data`, requestBody);
        const response = await fetch(`${baseUrl}/agent/call_associate_data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        logApiResponse(response.status, data);
        if (data.response && data.response.status === 'ok') {
            logEvent('Dados associados à chamada com sucesso', 'success');
        } else {
            throw new Error('Falha ao associar dados à chamada');
        }
    } catch (error) {
        console.error('Erro ao associar dados à chamada:', error);
        logEvent('Erro ao associar dados à chamada: ' + error.message, 'error');
    }
}

function getCurrentCallId() {
    // Implementar lógica para obter o ID da chamada atual
    // Por exemplo, você pode armazenar o ID da chamada em uma variável global quando receber o evento on_call_receive
    return currentCallId; // Certifique-se de definir esta variável em algum lugar do seu código
}

function getEventName(eventType) {
    switch (eventType) {
        case 'on_state_change': return 'Mudança de estado';
        case 'on_login': return 'Login';
        case 'on_logout': return 'Logout';
        case 'message': return 'Mensagem';
        case 'on_call_hold': return 'Chamada em espera';
        case 'on_call_accept': return 'Chamada aceita';
        case 'on_call_receive': return 'Chamada recebida';
        case 'on_call_associated_data': return 'Dados associados da chamada alterados';
        default: return 'Evento desconhecido';
    }
}

let heartbeatTimer;
let heartbeatInterval = 15000; // 15 segundos

function updateConnectionStatus(initialConnection = false) {
    const statusIndicator = document.getElementById('connection-status');
    statusIndicator.textContent = 'Conectado';
    statusIndicator.classList.add('connected');
    
    // Adicionar a classe 'ping' para iniciar a animação
    statusIndicator.classList.add('ping');
    
    // Remover a classe 'ping' após a animação terminar
    setTimeout(() => {
        statusIndicator.classList.remove('ping');
    }, 1000);

    // Reiniciar o timer do heartbeat
    resetHeartbeatTimer();
}

let svgTimer;
let timerCircle;
let timerText;

function createVisualTimer() {
    const timerContainer = document.getElementById('heartbeat-timer');
    timerContainer.innerHTML = ''; // Limpa o conteúdo existente
    
    if (typeof SVG === 'function') {
        svgTimer = SVG().addTo(timerContainer).size(40, 40);
        
        svgTimer.circle(38).fill('none').stroke({ color: '#555', width: 3 }).move(1, 1);
        timerCircle = svgTimer.circle(38).fill('none').stroke({ color: '#4CAF50', width: 3 }).move(1, 1);
        timerCircle.attr('stroke-dasharray', timerCircle.node.getTotalLength());
        timerCircle.attr('stroke-dashoffset', 0);
        
        timerText = svgTimer.text('15').font({
            family: 'Arial',
            size: 16,
            anchor: 'middle',
            leading: '1.5em'
        }).center(20, 20).attr({
            'alignment-baseline': 'middle',
            'text-anchor': 'middle'
        }).transform({ rotate: 90, origin: 'center center' });
    } else {
        // Fallback para HTML se SVG.js não estiver disponível
        const fallbackTimer = document.createElement('div');
        fallbackTimer.id = 'fallback-timer';
        fallbackTimer.style.width = '40px';
        fallbackTimer.style.height = '40px';
        fallbackTimer.style.borderRadius = '50%';
        fallbackTimer.style.border = '3px solid #555';
        fallbackTimer.style.display = 'flex';
        fallbackTimer.style.justifyContent = 'center';
        fallbackTimer.style.alignItems = 'center';
        fallbackTimer.style.fontSize = '16px';
        fallbackTimer.textContent = '15';
        
        timerContainer.appendChild(fallbackTimer);
        timerText = fallbackTimer;
    }
}

function resetHeartbeatTimer() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    if (!svgTimer && !timerText) {
        createVisualTimer();
    }

    let secondsLeft = 15;

    function updateTimer() {
        if (typeof SVG === 'function' && timerCircle && timerCircle.node) {
            const progress = (15 - secondsLeft) / 15;
            const dashArray = timerCircle.node.getTotalLength();
            const dashOffset = dashArray * progress;
            
            timerCircle.attr('stroke-dasharray', dashArray);
            timerCircle.attr('stroke-dashoffset', dashOffset);
        } else if (timerText) {
            // Atualiza o estilo do timer fallback
            const progress = (15 - secondsLeft) / 15;
            timerText.style.background = `conic-gradient(#4CAF50 ${progress * 360}deg, #555 ${progress * 360}deg)`;
        }
        
        if (timerText) {
            if (typeof SVG === 'function') {
                timerText.text(secondsLeft.toString());
            } else {
                timerText.textContent = secondsLeft.toString();
            }
        }

        if (secondsLeft <= 0) {
            clearInterval(heartbeatTimer);
            secondsLeft = 15;
        } else {
            secondsLeft--;
        }
    }

    updateTimer();
    heartbeatTimer = setInterval(updateTimer, 1000);
}

function updateAgentState(state, pauseName = null) {
    currentState = state;
    const stateElement = document.getElementById('current-state');
    let displayState = state;
    
    if (state.toLowerCase() === 'ready_free' || state.toLowerCase() === 'available') {
        displayState = 'Disponível';
    }
    
    stateElement.textContent = pauseName ? `${displayState} - ${pauseName}` : displayState;

    // Atualizar a interface com base no novo estado
    document.getElementById('available-btn').disabled = false;
    document.getElementById('pause-btn').disabled = false;
    console.log('Estado atual:', state, 'Botões de disponível e pausa habilitados');
}

let pauseMenuInitialized = false;

function initializePauseMenu() {
    if (!pauseMenuInitialized) {
        const pauseSelect = document.getElementById('pause-reason');
        pauseSelect.innerHTML = ''; // Limpar opções existentes
        if (pauseReasons && pauseReasons.length > 0) {
            pauseReasons.forEach(reason => {
                const option = document.createElement('option');
                option.value = reason.id;
                option.textContent = reason.pause;
                pauseSelect.appendChild(option);
            });
        } else {
            const option = document.createElement('option');
            option.textContent = 'Nenhuma pausa disponível';
            pauseSelect.appendChild(option);
        }
        pauseMenuInitialized = true;
    }
}

function showPauseMenu() {
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) {
        pauseMenu.style.display = 'block';
    } else {
        console.error('Elemento do menu de pausas não encontrado');
    }
}

async function setAgentState(stateId) {
    try {
        const setStateBody = {
            agent: agent,
            state_id: stateId
        };
        logApiRequest('POST', `${baseUrl}/agent/set_state`, setStateBody);

        const response = await fetch(`${baseUrl}/agent/set_state`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(setStateBody)
        });

        const data = await response.json();
        logApiResponse(response.status, data);

        if (!response.ok) {
            throw new Error('Falha ao definir estado do agente');
        }
        
        if (data.response && data.response.status === 'ok') {
            let stateName, pauseName;
            if (stateId === 2 || stateId === 3) {
                stateName = 'Disponível';
                pauseName = null;
            } else {
                stateName = 'Pausa';
                pauseName = pauseReasons.find(reason => reason.id === stateId)?.pause;
            }
            updateAgentState(stateName, pauseName);
            logEvent(`Estado alterado para ${stateName}${pauseName ? ` - ${pauseName}` : ''}`, 'success');

            if (stateId !== 2 && stateId !== 3) {
                document.getElementById('pause-menu').classList.add('hidden');
            }
        } else {
            throw new Error('Resposta inválida do servidor');
        }
    } catch (error) {
        console.error('Erro ao definir estado do agente:', error);
        logEvent('Erro ao definir estado do agente: ' + error.message, 'error');
    }
}

async function setAvailableState() {
    await setAgentState(2);
}

async function setPauseState() {
    const pauseReason = document.getElementById('pause-reason').value;
    await setAgentState(parseInt(pauseReason));
    document.getElementById('pause-menu').style.display = 'none';
}

function handleError(error) {
    console.error('Erro na conexão SSE:', error);
    logEvent('Erro na conexão SSE: ' + JSON.stringify(error), 'error');
    if (eventSource) {
        eventSource.close();
    }
}

function handleOpen(event) {
    console.log('Conexão SSE estabelecida');
    logEvent('Conexão SSE estabelecida', 'success');
    updateConnectionStatus(true);
}

async function resetConnections() {
    logEvent('Iniciando reinicialização das conexões...', 'info');

    if (!baseUrl || baseUrl === 'undefined') {
        const newBaseUrl = await promptForBaseUrl();
        if (!newBaseUrl) {
            logEvent('Operação cancelada: URL base não fornecida', 'error');
            return;
        }
        baseUrl = newBaseUrl;
        logEvent(`Nova URL base definida: ${baseUrl}`, 'info');
    }

    try {
        // Obter todas as assinaturas ativas
        logEvent('Obtendo assinaturas ativas...', 'info');
        const subscriptionsResponse = await fetch(`${baseUrl}/agent/monitor/get_subscriptions?format=json`);
        const subscriptionsData = await subscriptionsResponse.json();

        if (subscriptionsData.response && subscriptionsData.response.subscriptions) {
            const subscriptions = subscriptionsData.response.subscriptions;
            logEvent(`${subscriptions.length} assinaturas encontradas.`, 'info');

            // Fechar todos os canais e cancelar todas as assinaturas
            for (const subscription of subscriptions) {
                logEvent(`Fechando canal ${subscription.channel_id}...`, 'info');
                await fetch(`${baseUrl}/agent/monitor/close_channel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel_id: subscription.channel_id })
                });

                logEvent(`Cancelando assinatura ${subscription.id}...`, 'info');
                await fetch(`${baseUrl}/agent/monitor/unsubscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: subscription.id })
                });
            }

            // Fechar a conexão EventSource atual
            if (eventSource) {
                eventSource.close();
                eventSource = null;
                logEvent('Conexão EventSource fechada.', 'info');
            }

            logEvent('Todas as conexões foram encerradas com sucesso.', 'success');
            
            // Reconectar após um breve intervalo
            setTimeout(async () => {
                logEvent('Iniciando nova conexão...', 'info');
                await connectAndSubscribe();
            }, 2000);
        } else {
            throw new Error('Falha ao obter assinaturas');
        }
    } catch (error) {
        console.error('Erro ao encerrar conexões:', error);
        logEvent('Erro ao encerrar conexões: ' + error.message, 'error');
    }
}

function promptForBaseUrl() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1000';

        const content = document.createElement('div');
        content.style.backgroundColor = 'white';
        content.style.padding = '20px';
        content.style.borderRadius = '5px';
        content.innerHTML = `
            <h3>Digite o IP do servidor e a porta</h3>
            <input type="text" id="base-ip-input" placeholder="IP do servidor">
            <input type="text" id="base-port-input" placeholder="Porta" value="8582">
            <button id="confirm-base-url">Confirmar</button>
            <button id="cancel-base-url">Cancelar</button>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        document.getElementById('confirm-base-url').addEventListener('click', () => {
            const newBaseIp = document.getElementById('base-ip-input').value;
            const newBasePort = document.getElementById('base-port-input').value || '8582';
            document.body.removeChild(modal);
            resolve(`http://${newBaseIp}:${newBasePort}/interact_cti/v1.0`);
        });

        document.getElementById('cancel-base-url').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });
    });
}

function logEvent(message, type = 'info', data = null) {
    // Não exibir heartbeats
    if (type === 'channel' && data && Object.keys(data).length === 0) {
        return;
    }

    const logContainer = document.getElementById('log-container');
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry', type);

    const icon = getIconForType(type);
    const timestamp = new Date().toLocaleTimeString();
    
    const summaryDiv = document.createElement('div');
    summaryDiv.classList.add('log-summary');
    
    if (data) {
        summaryDiv.innerHTML = `${icon} [${timestamp}] ${message} <i class="fas fa-chevron-down"></i>`;
    } else {
        summaryDiv.innerHTML = `${icon} [${timestamp}] ${message}`;
    }
    
    logEntry.appendChild(summaryDiv);

    if (data) {
        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('log-details', 'hidden');
        
        if (data.request && data.response) {
            const requestDiv = createDetailSection('Request', data.request);
            const responseDiv = createDetailSection('Response', data.response);
            detailsDiv.appendChild(requestDiv);
            detailsDiv.appendChild(responseDiv);
        } else {
            const dataPre = document.createElement('pre');
            dataPre.textContent = JSON.stringify(data, null, 2);
            detailsDiv.appendChild(dataPre);
        }
        
        logEntry.appendChild(detailsDiv);
        
        summaryDiv.addEventListener('click', () => {
            detailsDiv.classList.toggle('hidden');
            summaryDiv.querySelector('.fa-chevron-down').classList.toggle('fa-chevron-up');
        });
    }

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // Animate the new log entry
    anime({
        targets: logEntry,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 300,
        easing: 'easeOutQuad'
    });
}

function createDetailSection(title, data) {
    const sectionDiv = document.createElement('div');
    sectionDiv.classList.add('detail-section');
    
    const titleElement = document.createElement('h4');
    titleElement.textContent = title;
    sectionDiv.appendChild(titleElement);

    const contentPre = document.createElement('pre');
    contentPre.textContent = JSON.stringify(data, null, 2);
    sectionDiv.appendChild(contentPre);

    return sectionDiv;
}

function getIconForType(type) {
    switch (type) {
        case 'channel': return '<i class="fas fa-satellite-dish"></i>';
        case 'request': return '<i class="fas fa-paper-plane"></i>';
        case 'response': return '<i class="fas fa-reply"></i>';
        case 'error': return '<i class="fas fa-exclamation-triangle"></i>';
        case 'subscribe': return '<i class="fas fa-bell"></i>';
        case 'heartbeat': return '<i class="fas fa-heartbeat"></i>';
        case 'login': return '<i class="fas fa-sign-in-alt"></i>';
        case 'logout': return '<i class="fas fa-sign-out-alt"></i>';
        case 'state_change': return '<i class="fas fa-exchange-alt"></i>';
        case 'call': return '<i class="fas fa-phone"></i>';
        case 'pause': return '<i class="fas fa-pause-circle"></i>';
        default: return '<i class="fas fa-info-circle"></i>';
    }
}

function logApiRequest(method, endpoint, body = null) {
    apiRequestData = { method, endpoint, body };
}

function logApiResponse(status, data) {
    const type = status >= 200 && status < 300 ? 'response' : 'error';
    if (apiRequestData) {
        const message = `${apiRequestData.method} ${apiRequestData.endpoint} - ${status}`;
        logEvent(message, type, { request: apiRequestData.body, response: data });
        apiRequestData = null;
    } else {
        console.warn('API response received without corresponding request data');
        const message = `API Response - ${status}`;
        logEvent(message, type, { response: data });
    }
}

let apiRequestData = null;

function logEvent(message, type = 'info', data = null) {
    // Não exibir heartbeats
    if (type === 'channel' && data && Object.keys(data).length === 0) {
        return;
    }

    const logContainer = document.getElementById('log-container');
    const logEntry = document.createElement('div');
    logEntry.classList.add('log-entry', type);

    const icon = getIconForType(type);
    const timestamp = new Date().toLocaleTimeString();
    
    const summaryDiv = document.createElement('div');
    summaryDiv.classList.add('log-summary');
    
    if (data) {
        summaryDiv.innerHTML = `${icon} [${timestamp}] ${message} <i class="fas fa-chevron-down"></i>`;
    } else {
        summaryDiv.innerHTML = `${icon} [${timestamp}] ${message}`;
    }
    
    logEntry.appendChild(summaryDiv);

    if (data) {
        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('log-details', 'hidden');
        
        if (data.request || data.response) {
            if (data.request) {
                const requestDiv = createDetailSection('Request', data.request);
                detailsDiv.appendChild(requestDiv);
            }
            if (data.response) {
                const responseDiv = createDetailSection('Response', data.response);
                detailsDiv.appendChild(responseDiv);
            }
        } else {
            const dataPre = document.createElement('pre');
            dataPre.textContent = JSON.stringify(data, null, 2);
            detailsDiv.appendChild(dataPre);
        }
        
        logEntry.appendChild(detailsDiv);
        
        summaryDiv.addEventListener('click', () => {
            detailsDiv.classList.toggle('hidden');
            summaryDiv.querySelector('.fa-chevron-down').classList.toggle('fa-chevron-up');
        });
    }

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;

    // Animate the new log entry
    anime({
        targets: logEntry,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 300,
        easing: 'easeOutQuad'
    });
}
