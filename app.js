import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfXiW_MVh985LU30_6dpSoKtTxqhz38ho",
  authDomain: "plantao-fono.firebaseapp.com",
  projectId: "plantao-fono",
  storageBucket: "plantao-fono.firebasestorage.app",
  messagingSenderId: "301818511616",
  appId: "1:301818511616:web:7ac5795c6e1b713cfd73e5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let calendar;
let todosEventos = [];
const feriadosAutoMap = new Map(); // Mapa único por data para evitar qualquer duplicidade
let idEdicaoAtual = null;

const CORES = {
  PLANTAO: '#10b981',
  FOLGA: '#3b82f6',
  FERIAS: '#f59e0b',
  AFASTAMENTO: '#a855f7',
  FERIADO: '#ef4444'
};

document.addEventListener('DOMContentLoaded', () => {
  carregarCacheLocal();
  inicializarCalendario();
  escutarFirebase();
  configurarEventosUI();
  carregarFeriadosNacionais(new Date().getFullYear());
});

function carregarCacheLocal() {
  const localData = localStorage.getItem('escalas_backup_local');
  if (localData) {
    try {
      todosEventos = JSON.parse(localData);
    } catch (e) {
      console.warn("Erro ao ler cache local", e);
    }
  }
}

function salvarCacheLocal() {
  localStorage.setItem('escalas_backup_local', JSON.stringify(todosEventos));
}

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
    buttonText: { today: 'Hoje', month: 'Mês', list: 'Lista' },
    dateClick: (info) => abrirModalNovaData(info.dateStr),
    eventClick: (info) => {
      if (info.event.extendedProps.isFeriadoAuto) return;
      abrirModalEdicao(info.event);
    },
    datesSet: (info) => {
      carregarFeriadosNacionais(info.view.currentStart.getFullYear());
      atualizarContadores();
    }
  });
  calendar.render();
  aplicarFiltrosEAtualizar();
}

function escutarFirebase() {
  const colRef = collection(db, 'escalas');
  
  onSnapshot(colRef, 
    (snapshot) => {
      todosEventos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      salvarCacheLocal();
      atualizarListasDinamicas();
      aplicarFiltrosEAtualizar();
    },
    (error) => {
      console.error("Erro no Firebase onSnapshot:", error);
      aplicarFiltrosEAtualizar();
    }
  );
}

// Busca feriados nacionais da API e garante que cada data receba apenas 1 entrada
async function carregarFeriadosNacionais(ano) {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (res.ok) {
      const data = await res.json();
      let alterou = false;
      
      data.forEach(f => {
        if (!feriadosAutoMap.has(f.date)) {
          feriadosAutoMap.set(f.date, {
            id: 'feriado-auto-' + f.date,
            title: `🎉 ${f.name}`,
            start: f.date,
            classNames: ['fc-event-feriado-auto'],
            isFeriadoAuto: true
          });
          alterou = true;
        }
      });
      
      if (alterou) {
        aplicarFiltrosEAtualizar();
      }
    }
  } catch (err) {
    console.warn("Erro ao carregar feriados automáticos:", err);
  }
}

function atualizarListasDinamicas() {
  const pessoasUnicas = [...new Set(todosEventos.map(e => e.pessoa).filter(Boolean))].sort();
  const categoriasUnicas = [...new Set(todosEventos.map(e => e.categoria).filter(Boolean))].sort();

  const datalistPessoas = document.getElementById('listaPessoas');
  if (datalistPessoas) {
    datalistPessoas.innerHTML = '';
    pessoasUnicas.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      datalistPessoas.appendChild(opt);
    });
  }

  const selectPessoa = document.getElementById('filtroPessoa');
  if (selectPessoa) {
    const valP = selectPessoa.value;
    selectPessoa.innerHTML = '<option value="TODAS">Todos os Profissionais</option>';
    pessoasUnicas.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      selectPessoa.appendChild(opt);
    });
    selectPessoa.value = valP;
  }

  const selectCat = document.getElementById('filtroCategoria');
  if (selectCat) {
    const valC = selectCat.value;
    selectCat.innerHTML = '<option value="TODAS">Todas as Categorias</option>';
    categoriasUnicas.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      selectCat.appendChild(opt);
    });
    selectCat.value = valC;
  }
}

function aplicarFiltrosEAtualizar() {
  const catSel = document.getElementById('filtroCategoria') ? document.getElementById('filtroCategoria').value : 'TODAS';
  const pessoaSel = document.getElementById('filtroPessoa') ? document.getElementById('filtroPessoa').value : 'TODAS';

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

  const listaFeriados = Array.from(feriadosAutoMap.values());

  if (calendar) {
    calendar.removeAllEvents();
    calendar.addEventSource([...fcEvents, ...listaFeriados]);
  }
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
  if (!container || !calendar) return;
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

function mostrarToast(mensagem) {
  const toast = document.getElementById('toastSucesso');
  const msgEl = document.getElementById('toastMensagem');
  if (toast && msgEl) {
    msgEl.textContent = mensagem;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }
}

const modal = document.getElementById('modalForm');
const form = document.getElementById('formEscala');
const btnSubmit = document.getElementById('btnSubmitForm');

function abrirModalNovaData(dataStr) {
  idEdicaoAtual = null;
  form.reset();
  document.getElementById('inputData').value = dataStr;
  document.getElementById('modalTitulo').textContent = 'Marcar Registo na Escala';
  document.getElementById('btnExcluir').classList.add('hidden');
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Guardar';
  }
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
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Guardar';
  }
  modal.classList.remove('hidden');
}

function fecharModal() {
  modal.classList.add('hidden');
  form.reset();
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Guardar';
  }
}

function configurarEventosUI() {
  document.getElementById('btnNovoRegistro').addEventListener('click', () => abrirModalNovaData(new Date().toISOString().split('T')[0]));
  document.getElementById('btnFecharModal').addEventListener('click', fecharModal);

  document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltrosEAtualizar);
  document.getElementById('filtroPessoa').addEventListener('change', aplicarFiltrosEAtualizar);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const pessoaVal = document.getElementById('inputPessoa').value.trim();
    const dataVal = document.getElementById('inputData').value;
    if (!pessoaVal || !dataVal) {
      alert('Por favor, preencha o nome do profissional e a data.');
      return;
    }

    const payload = {
      pessoa: pessoaVal,
      categoria: document.getElementById('inputCategoria').value.trim() || 'Geral',
      tipo: document.getElementById('inputTipo').value,
      data: dataVal,
      cargaHoraria: Number(document.getElementById('inputCH').value) || 2,
      observacao: document.getElementById('inputObs').value.trim(),
      atualizadoEm: new Date().toISOString()
    };

    const isEdit = Boolean(idEdicaoAtual);
    const targetId = idEdicaoAtual;

    fecharModal();
    mostrarToast(isEdit ? '✅ Registo atualizado com sucesso!' : '✅ Plantão marcado com sucesso!');

    if (isEdit) {
      const idx = todosEventos.findIndex(x => x.id === targetId);
      if (idx !== -1) todosEventos[idx] = { id: targetId, ...payload };
    } else {
      const tempId = 'temp-' + Date.now();
      todosEventos.push({ id: tempId, ...payload });
    }

    salvarCacheLocal();
    aplicarFiltrosEAtualizar();
    atualizarListasDinamicas();

    if (isEdit && !targetId.startsWith('temp-')) {
      updateDoc(doc(db, 'escalas', targetId), payload).catch(err => console.error("Erro Firebase:", err));
    } else {
      addDoc(collection(db, 'escalas'), payload).then(docRef => {
        console.log("Salvo no Firebase:", docRef.id);
      }).catch(err => console.error("Erro Firebase:", err));
    }
  });

  document.getElementById('btnExcluir').addEventListener('click', async () => {
    if (confirm('Deseja realmente eliminar este registo?')) {
      const idParaRemover = idEdicaoAtual;
      
      todosEventos = todosEventos.filter(x => x.id !== idParaRemover);
      salvarCacheLocal();
      aplicarFiltrosEAtualizar();
      fecharModal();
      mostrarToast('🗑️ Registo eliminado com sucesso.');

      try {
        if (idParaRemover && !idParaRemover.startsWith('temp-')) {
          await deleteDoc(doc(db, 'escalas', idParaRemover));
        }
      } catch (e) {}
    }
  });

  document.getElementById('btnImportarDados').addEventListener('click', importarDadosIniciais);
}

async function importarDadosIniciais() {
  const btn = document.getElementById('btnImportarDados');
  btn.disabled = true;
  btn.textContent = '⏳ A importar...';

  try {
    const res = await fetch('dados_iniciais.json');
    if (!res.ok) throw new Error('dados_iniciais.json não encontrado');
    const dados = await res.json();

    const batch = writeBatch(db);
    dados.forEach(item => {
      const docRef = doc(collection(db, 'escalas'));
      batch.set(docRef, item);
    });

    await batch.commit();
    mostrarToast('✅ Dados importados com sucesso!');
  } catch (err) {
    alert('Erro na importação: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Carregar Dados Iniciais';
  }
}