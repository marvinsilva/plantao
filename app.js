import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCfXiW_MVh985LU30_6dpSoKtTxqhz38ho",
  authDomain: "plantao-fono.firebaseapp.com",
  projectId: "plantao-fono",
  storageBucket: "plantao-fono.firebasestorage.app",
  messagingSenderId: "301818511616",
  appId: "1:301818511616:web:7ac5795c6e1b713cfd73e5"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let calendar;
let todosEventos = [];
let feriadosAuto = [];
let idEdicaoAtual = null;

const CORES = {
  PLANTAO: '#10b981',      // Verde (X)
  FOLGA: '#3b82f6',        // Azul (F)
  FERIAS: '#f59e0b',       // Amarelo
  AFASTAMENTO: '#a855f7',  // Roxo
  FERIADO: '#ef4444'       // Vermelho
};

document.addEventListener('DOMContentLoaded', () => {
  inicializarCalendario();
  escutarFirebase();
  configurarEventosUI();
  carregarFeriadosNacionais(new Date().getFullYear());
  carregarFeriadosNacionais(new Date().getFullYear() + 1);
});

function inicializarCalendario() {
  const calendarEl = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'pt-br',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,listMonth'
    },
    buttonText: {
      today: 'Hoje',
      month: 'Mês',
      list: 'Lista'
    },
    dateClick: (info) => abrirModalNovaData(info.dateStr),
    eventClick: (info) => {
      if (info.event.extendedProps.isFeriadoAuto) return; // Feriados automáticos são apenas leitura
      abrirModalEdicao(info.event);
    },
    datesSet: (info) => {
      const anoVisualizado = info.view.currentStart.getFullYear();
      carregarFeriadosNacionais(anoVisualizado);
      atualizarContadores();
    }
  });
  calendar.render();
}

// Sincronização em Tempo Real (Firebase Firestore)
function escutarFirebase() {
  const colRef = collection(db, 'escalas');
  
  onSnapshot(colRef, 
    (snapshot) => {
      todosEventos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      document.getElementById('statusConexao').classList.add('hidden');
      atualizarListasDinamicas();
      aplicarFiltrosEAtualizar();
    },
    (error) => {
      console.error("Erro na ligação ao Firebase:", error);
      const statusEl = document.getElementById('statusConexao');
      statusEl.textContent = "Aviso de Conexão: " + error.message;
      statusEl.classList.remove('hidden');
    }
  );
}

// Sincronização Automática de Feriados Nacionais via API (BrasilAPI)
async function carregarFeriadosNacionais(ano) {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (res.ok) {
      const data = await res.json();
      data.forEach(f => {
        if (!feriadosAuto.some(e => e.start === f.date && e.title === f.name)) {
          feriadosAuto.push({
            id: 'feriado-auto-' + f.date,
            title: `🎉 ${f.name}`,
            start: f.date,
            classNames: ['fc-event-feriado-auto'],
            isFeriadoAuto: true
          });
        }
      });
      aplicarFiltrosEAtualizar();
    }
  } catch (err) {
    console.warn("Não foi possível carregar feriados automáticos:", err);
  }
}

// Atualização de Nomes e Categorias Inseridos Dinamicamente
function atualizarListasDinamicas() {
  const pessoasUnicas = [...new Set(todosEventos.map(e => e.pessoa).filter(Boolean))].sort();
  const categoriasUnicas = [...new Set(todosEventos.map(e => e.categoria).filter(Boolean))].sort();

  // Atualizar Datalist do Form
  const datalistPessoas = document.getElementById('listaPessoas');
  datalistPessoas.innerHTML = '';
  pessoasUnicas.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    datalistPessoas.appendChild(opt);
  });

  const datalistCat = document.getElementById('listaCategorias');
  datalistCat.innerHTML = '';
  categoriasUnicas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    datalistCat.appendChild(opt);
  });

  // Atualizar Filtro de Profissionais
  const selectPessoa = document.getElementById('filtroPessoa');
  const valorAtualP = selectPessoa.value;
  selectPessoa.innerHTML = '<option value="TODAS">Todos os Profissionais</option>';
  pessoasUnicas.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    selectPessoa.appendChild(opt);
  });
  selectPessoa.value = valorAtualP;

  // Atualizar Filtro de Categorias
  const selectCat = document.getElementById('filtroCategoria');
  const valorAtualC = selectCat.value;
  selectCat.innerHTML = '<option value="TODAS">Todas as Categorias</option>';
  categoriasUnicas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    selectCat.appendChild(opt);
  });
  selectCat.value = valorAtualC;
}

function aplicarFiltrosEAtualizar() {
  const catSel = document.getElementById('filtroCategoria').value;
  const pessoaSel = document.getElementById('filtroPessoa').value;

  const eventosFiltrados = todosEventos.filter(ev => {
    const matchCat = catSel === 'TODAS' || ev.categoria === catSel;
    const matchPessoa = pessoaSel === 'TODAS' || ev.pessoa === pessoaSel;
    return matchCat && matchPessoa;
  });

  const fcEvents = eventosFiltrados.map(ev => ({
    id: ev.id,
    title: `${ev.pessoa} (${obterRotulo(ev.tipo)})`,
    start: ev.data,
    backgroundColor: CORES[ev.tipo] || '#64748b',
    extendedProps: ev
  }));

  calendar.removeAllEvents();
  calendar.addEventSource([...fcEvents, ...feriadosAuto]);
  atualizarContadores();
}

function obterRotulo(tipo) {
  switch (tipo) {
    case 'PLANTAO': return 'X';
    case 'FOLGA': return 'F';
    case 'FERIAS': return 'Férias';
    case 'AFASTAMENTO': return 'Afastam.';
    case 'FERIADO': return 'Feriado';
    default: return tipo;
  }
}

function atualizarContadores() {
  const container = document.getElementById('listaContadores');
  container.innerHTML = '';

  const dataAtual = calendar.getDate();
  const mesAtual = dataAtual.getMonth();
  const anoAtual = dataAtual.getFullYear();

  const contagem = {};

  todosEventos.forEach(ev => {
    if (!ev.data) return;
    const d = new Date(ev.data + 'T00:00:00');
    if (d.getMonth() === mesAtual && d.getFullYear() === anoAtual && ev.tipo === 'PLANTAO') {
      contagem[ev.pessoa] = (contagem[ev.pessoa] || 0) + 1;
    }
  });

  if (Object.keys(contagem).length === 0) {
    container.innerHTML = '<p class="text-slate-400 italic">Nenhum plantão neste mês.</p>';
    return;
  }

  Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([nome, qtd]) => {
    const item = document.createElement('div');
    item.className = 'flex justify-between items-center py-1 border-b border-slate-100';
    item.innerHTML = `<span class="font-medium">${nome}</span> <span class="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full text-xs">${qtd} plantões</span>`;
    container.appendChild(item);
  });
}

// Modal e Formulário
const modal = document.getElementById('modalForm');
const form = document.getElementById('formEscala');
const btnSubmit = document.getElementById('btnSubmitForm');

function abrirModalNovaData(dataStr) {
  idEdicaoAtual = null;
  form.reset();
  document.getElementById('inputData').value = dataStr;
  document.getElementById('modalTitulo').textContent = 'Marcar Registo na Escala';
  document.getElementById('btnExcluir').classList.add('hidden');
  btnSubmit.disabled = false;
  btnSubmit.textContent = 'Guardar';
  modal.classList.remove('hidden');
}

function abrirModalEdicao(fcEvent) {
  idEdicaoAtual = fcEvent.id;
  const dados = fcEvent.extendedProps;

  document.getElementById('inputPessoa').value = dados.pessoa || '';
  document.getElementById('inputCategoria').value = dados.categoria || '';
  document.getElementById('inputTipo').value = dados.tipo || 'PLANTAO';
  document.getElementById('inputData').value = dados.data || '';
  document.getElementById('inputCH').value = dados.cargaHoraria || 2;
  document.getElementById('inputObs').value = dados.observacao || '';

  document.getElementById('modalTitulo').textContent = 'Editar Registo';
  document.getElementById('btnExcluir').classList.remove('hidden');
  btnSubmit.disabled = false;
  btnSubmit.textContent = 'Guardar';
  modal.classList.remove('hidden');
}

function fecharModal() {
  modal.classList.add('hidden');
  form.reset();
  btnSubmit.disabled = false;
  btnSubmit.textContent = 'Guardar';
}

function configurarEventosUI() {
  document.getElementById('btnNovoRegistro').addEventListener('click', () => abrirModalNovaData(new Date().toISOString().split('T')[0]));
  document.getElementById('btnFecharModal').addEventListener('click', fecharModal);

  document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltrosEAtualizar);
  document.getElementById('filtroPessoa').addEventListener('change', aplicarFiltrosEAtualizar);

  // Envio de formulário com prevenção de duplicação
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pessoaVal = document.getElementById('inputPessoa').value.trim();
    if (!pessoaVal) {
      alert('Por favor, informe o nome do profissional.');
      return;
    }

    // Bloquear o botão para evitar envios múltiplos
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'A guardar...';

    const payload = {
      pessoa: pessoaVal,
      categoria: document.getElementById('inputCategoria').value.trim() || 'Geral',
      tipo: document.getElementById('inputTipo').value,
      data: document.getElementById('inputData').value,
      cargaHoraria: Number(document.getElementById('inputCH').value),
      observacao: document.getElementById('inputObs').value.trim(),
      atualizadoEm: new Date().toISOString()
    };

    try {
      if (idEdicaoAtual) {
        await updateDoc(doc(db, 'escalas', idEdicaoAtual), payload);
      } else {
        await addDoc(collection(db, 'escalas'), payload);
      }
      fecharModal(); // Fecha a aba/modal automaticamente após o envio!
    } catch (err) {
      alert('Erro ao guardar registo: ' + err.message);
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Guardar';
    }
  });

  document.getElementById('btnExcluir').addEventListener('click', async () => {
    if (confirm('Deseja realmente eliminar este registo?')) {
      try {
        await deleteDoc(doc(db, 'escalas', idEdicaoAtual));
        fecharModal();
      } catch (err) {
        alert('Erro ao eliminar: ' + err.message);
      }
    }
  });

  document.getElementById('btnImportarDados').addEventListener('click', importarDadosIniciais);
}

// Carga Inicial dos dados extraídos do Excel
async function importarDadosIniciais() {
  if (todosEventos.length > 0) {
    if (!confirm('Já existem registos salvos no Firebase. Deseja reimportar os dados das planilhas?')) {
      return;
    }
  }

  const btn = document.getElementById('btnImportarDados');
  btn.disabled = true;
  btn.textContent = '⏳ A importar...';

  try {
    const res = await fetch('dados_iniciais.json');
    if (!res.ok) {
      throw new Error('Certifique-se de que o ficheiro dados_iniciais.json está na raiz do site.');
    }
    const dados = await res.json();

    const batch = writeBatch(db);
    dados.forEach(item => {
      const docRef = doc(collection(db, 'escalas'));
      batch.set(docRef, item);
    });

    await batch.commit();
    alert(`Sucesso! ${dados.length} registos foram importados para o Firebase.`);
  } catch (err) {
    alert('Erro na importação: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Carregar Dados das Planilhas';
  }
}