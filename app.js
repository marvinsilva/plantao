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
const feriadosAutoMap = new Map();
const anosCarregados = new Set(); // Evita recarregar a API de feriados repetidamente
let idEdicaoAtual = null;

const CORES = {
  PLANTAO: '#10b981',
  FOLGA: '#3b82f6',
  FERIAS: '#f59e0b',
  AFASTAMENTO: '#a855f7',
  FERIADO: '#ef4444'
};

const REGRAS_FERIADOES = [
  { id: 'ano_novo', nome: '🎆 Ano Novo', datas: { '2026': ['2026-01-01', '2026-01-02', '2026-01-03'], '2027': ['2027-01-01', '2027-01-02'] } },
  { id: 'carnaval', nome: '🎭 Carnaval', datas: { '2026': ['2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17'], '2027': ['2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09'] } },
  { id: 'paixao', nome: '✝️ Paixão de Cristo', datas: { '2026': ['2026-04-03', '2026-04-04'], '2027': ['2027-03-26', '2027-03-27'] } },
  { id: 'tiradentes', nome: '🇧🇷 Tiradentes', datas: { '2026': ['2026-04-18', '2026-04-19', '2026-04-20', '2026-04-21'], '2027': ['2027-04-21'] } },
  { id: 'trabalho', nome: '🛠️ Dia do Trabalho', datas: { '2026': ['2026-05-01', '2026-05-02'], '2027': ['2027-05-01'] } },
  { id: 'corpus', nome: '🍞 Corpus Christi', datas: { '2026': ['2026-06-04', '2026-06-05', '2026-06-06'], '2027': ['2027-05-27', '2027-05-28', '2027-05-29'] } },
  { id: 'independencia', nome: '🟢 Independência', datas: { '2026': ['2026-09-05', '2026-09-06', '2026-09-07'], '2027': ['2027-09-07'] } },
  { id: 'aparecida', nome: '🙏 Nossa Sra. Aparecida', datas: { '2026': ['2026-10-10', '2026-10-11', '2026-10-12'], '2027': ['2027-10-12'] } },
  { id: 'finados', nome: '🕯️ Finados', datas: { '2026': ['2026-10-31', '2026-11-01', '2026-11-02'], '2027': ['2027-11-02'] } },
  { id: 'consciencia', nome: '✊ Consciência Negra', datas: { '2026': ['2026-11-20', '2026-11-21'], '2027': ['2027-11-20'] } },
  { id: 'natal', nome: '🎄 Natal', datas: { '2026': ['2026-12-25', '2026-12-26'], '2027': ['2027-12-25', '2027-12-26'] } }
];

document.addEventListener('DOMContentLoaded', () => {
  carregarCacheLocal();
  inicializarCalendario();
  escutarFirebase();
  configurarEventosUI();
});

function carregarCacheLocal() {
  const localData = localStorage.getItem('escalas_backup_local');
  if (localData) {
    try { todosEventos = JSON.parse(localData); } catch (e) {}
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
      todosEventos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      salvarCacheLocal();
      atualizarListasDinamicas();
      aplicarFiltrosEAtualizar();
      atualizarTabelaFeriadoes();
    },
    () => {
      aplicarFiltrosEAtualizar();
      atualizarTabelaFeriadoes();
    }
  );
}

async function carregarFeriadosNacionais(ano) {
  if (anosCarregados.has(ano)) return;
  anosCarregados.add(ano);

  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (res.ok) {
      const data = await res.json();
      data.forEach(f => {
        if (!feriadosAutoMap.has(f.date)) {
          feriadosAutoMap.set(f.date, {
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
  } catch (err) {}
}

function atualizarListasDinamicas() {
  const pessoasUnicas = [...new Set(todosEventos.map(e => e.pessoa).filter(p => p && !p.includes('Finados') && !p.includes('Proclamação') && !p.includes('Consciência')))].sort();
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

  const feriadosPorData = new Map();

  // 1. Feriados automáticos da API
  feriadosAutoMap.forEach((feriado, date) => {
    feriadosPorData.set(date, feriado);
  });

  const fcEvents = [];
  const chavesPessoasVistas = new Set();

  // 2. Filtrar e deduplicar os registros do banco de dados
  todosEventos.forEach(ev => {
    if (!ev.data) return;

    const ehFeriadoGenerico = ev.tipo === 'FERIADO' || !ev.pessoa || ev.pessoa.trim() === '' || 
                              ev.pessoa.toLowerCase().includes('finados') || 
                              ev.pessoa.toLowerCase().includes('proclamação') || 
                              ev.pessoa.toLowerCase().includes('consciência');

    if (ehFeriadoGenerico) {
      if (!feriadosPorData.has(ev.data)) {
        const nomeFeriado = ev.observacao || ev.pessoa || 'Feriado';
        feriadosPorData.set(ev.data, {
          id: 'feriado-ev-' + ev.data,
          title: `🎉 ${nomeFeriado.replace(/^🎉\s*/, '')}`,
          start: ev.data,
          backgroundColor: CORES['FERIADO'],
          classNames: ['fc-event-feriado-auto'],
          isFeriadoAuto: true
        });
      }
      return;
    }

    const matchCat = catSel === 'TODAS' || ev.categoria === catSel;
    const matchPessoa = pessoaSel === 'TODAS' || ev.pessoa === pessoaSel;

    if (matchCat && matchPessoa) {
      const chaveUnica = `${ev.pessoa}_${ev.data}_${ev.tipo}`;
      if (!chavesPessoasVistas.has(chaveUnica)) {
        chavesPessoasVistas.add(chaveUnica);
        fcEvents.push({
          id: ev.id,
          title: `${ev.pessoa} (${obterRotulo(ev.tipo)})`,
          start: ev.data,
          backgroundColor: CORES[ev.tipo] || '#64748b',
          extendedProps: ev
        });
      }
    }
  });

  const listaFeriadosUnicos = Array.from(feriadosPorData.values());
  const todosEventosCalendario = [...fcEvents, ...listaFeriadosUnicos];

  if (calendar) {
    // REMOVE TODAS AS FONTES ANTERIORES PARA EVITAR MULTIPLICAÇÃO AO NAVEGAR
    calendar.removeAllEventSources();
    calendar.addEventSource(todosEventosCalendario);
  }
  atualizarContadores();
  atualizarTabelaFeriadoes();
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
    if (d.getMonth() === mesAtual && d.getFullYear() === anoAtual && ev.tipo === 'PLANTAO' && ev.pessoa) {
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

function atualizarTabelaFeriadoes() {
  const corpoTabela = document.getElementById('corpoTabelaFeriadoes');
  if (!corpoTabela) return;

  corpoTabela.innerHTML = '';

  REGRAS_FERIADOES.forEach(regra => {
    const plantonistas2026 = obterPlantonistasFeriadao(regra.datas['2026']);
    const plantonistas2027 = obterPlantonistasFeriadao(regra.datas['2027']);

    const repetidos = plantonistas2026.filter(p => plantonistas2027.includes(p));

    let statusHtml = '<span class="bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-full text-xs">✅ Rodízio OK</span>';
    if (repetidos.length > 0) {
      statusHtml = `<span class="bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full text-xs flex items-center gap-1">⚠️ Repetição: ${repetidos.join(', ')}</span>`;
    } else if (plantonistas2026.length === 0 && plantonistas2027.length === 0) {
      statusHtml = '<span class="bg-slate-100 text-slate-500 text-xs italic px-2 py-1 rounded">Aguardando registos</span>';
    }

    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 hover:bg-slate-50 transition';
    tr.innerHTML = `
      <td class="p-3 border-r border-slate-200 font-semibold text-slate-800">${regra.nome}</td>
      <td class="p-3 border-r border-slate-200 text-xs text-slate-600">
        <div><b>2026:</b> ${formatarDatas(regra.datas['2026'])}</div>
        ${regra.datas['2027'] ? `<div><b>2027:</b> ${formatarDatas(regra.datas['2027'])}</div>` : ''}
      </td>
      <td class="p-3 border-r border-slate-200 bg-emerald-50/50">
        ${renderBadgesPessoas(plantonistas2026, 'emerald')}
      </td>
      <td class="p-3 border-r border-slate-200 bg-blue-50/50">
        ${renderBadgesPessoas(plantonistas2027, 'blue')}
      </td>
      <td class="p-3">${statusHtml}</td>
    `;

    corpoTabela.appendChild(tr);
  });
}

function obterPlantonistasFeriadao(datasArray) {
  if (!datasArray || datasArray.length === 0) return [];

  const nomes = todosEventos
    .filter(ev => datasArray.includes(ev.data) && (ev.tipo === 'PLANTAO' || ev.tipo === 'FERIADO') && ev.pessoa && !ev.pessoa.toLowerCase().includes('finados') && !ev.pessoa.toLowerCase().includes('proclamação'))
    .map(ev => ev.pessoa);

  return [...new Set(nomes)].sort();
}

function renderBadgesPessoas(listaPessoas, cor) {
  if (listaPessoas.length === 0) {
    return '<span class="text-slate-400 italic text-xs">Nenhum plantão</span>';
  }
  const bgClass = cor === 'emerald' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800';
  return listaPessoas.map(nome => `<span class="${bgClass} font-bold px-2 py-0.5 rounded text-xs inline-block m-0.5">${nome}</span>`).join('');
}

function formatarDatas(datas) {
  if (!datas || datas.length === 0) return '-';
  if (datas.length === 1) {
    const d = datas[0].split('-');
    return `${d[2]}/${d[1]}`;
  }
  const dInicio = datas[0].split('-');
  const dFim = datas[datas.length - 1].split('-');
  return `${dInicio[2]}/${dInicio[1]} a ${dFim[2]}/${dFim[1]}`;
}

function mostrarToast(mensagem) {
  const toast = document.getElementById('toastSucesso');
  const msgEl = document.getElementById('toastMensagem');
  if (toast && msgEl) {
    msgEl.textContent = mensagem;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2800);
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
  const btnTabCalendario = document.getElementById('btnTabCalendario');
  const btnTabFeriadoes = document.getElementById('btnTabFeriadoes');
  const visaoCalendario = document.getElementById('visaoCalendario');
  const visaoFeriadoes = document.getElementById('visaoFeriadoes');

  if (btnTabCalendario && btnTabFeriadoes) {
    btnTabCalendario.addEventListener('click', () => {
      visaoCalendario.classList.remove('hidden');
      visaoFeriadoes.classList.add('hidden');
      btnTabCalendario.className = 'py-2.5 px-5 font-bold text-emerald-600 border-b-2 border-emerald-600 text-sm transition flex items-center gap-2';
      btnTabFeriadoes.className = 'py-2.5 px-5 font-bold text-slate-500 hover:text-slate-800 border-b-2 border-transparent text-sm transition flex items-center gap-2';
      if (calendar) calendar.render();
    });

    btnTabFeriadoes.addEventListener('click', () => {
      visaoCalendario.classList.add('hidden');
      visaoFeriadoes.classList.remove('hidden');
      btnTabFeriadoes.className = 'py-2.5 px-5 font-bold text-emerald-600 border-b-2 border-emerald-600 text-sm transition flex items-center gap-2';
      btnTabCalendario.className = 'py-2.5 px-5 font-bold text-slate-500 hover:text-slate-800 border-b-2 border-transparent text-sm transition flex items-center gap-2';
      atualizarTabelaFeriadoes();
    });
  }

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
    atualizarTabelaFeriadoes();

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
      atualizarTabelaFeriadoes();
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