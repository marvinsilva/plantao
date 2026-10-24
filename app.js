import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, writeBatch, getDocs 
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
const anosCarregados = new Set();
let idEdicaoAtual = null;

// Feriados que geram "feriadão". Plantão da fono é sempre aos SÁBADOS: o sábado do feriadão é calculado
// automaticamente (sábado mais próximo do feriado), então anos novos só precisam das datas abaixo.
const FERIADOS = [
  { id: 'ano_novo', nome: '🎆 Ano Novo', datas: { 2026: ['2026-01-01'], 2027: ['2027-01-01'], 2028: ['2028-01-01'] } },
  { id: 'carnaval', nome: '🎭 Carnaval', datas: { 2026: ['2026-02-16', '2026-02-17'], 2027: ['2027-02-08', '2027-02-09'], 2028: ['2028-02-28', '2028-02-29'] } },
  { id: 'paixao', nome: '✝️ Paixão de Cristo', datas: { 2026: ['2026-04-03'], 2027: ['2027-03-26'], 2028: ['2028-04-14'] } },
  { id: 'tiradentes', nome: '🇧🇷 Tiradentes', datas: { 2026: ['2026-04-21'], 2027: ['2027-04-21'], 2028: ['2028-04-21'] } },
  { id: 'trabalho', nome: '🛠️ Dia do Trabalho', datas: { 2026: ['2026-05-01'], 2027: ['2027-05-01'], 2028: ['2028-05-01'] } },
  { id: 'corpus', nome: '🍞 Corpus Christi', datas: { 2026: ['2026-06-04'], 2027: ['2027-05-27'], 2028: ['2028-06-15'] } },
  { id: 'independencia', nome: '🟢 Independência', datas: { 2026: ['2026-09-07'], 2027: ['2027-09-07'], 2028: ['2028-09-07'] } },
  { id: 'aparecida', nome: '🙏 Nossa Sra. Aparecida', datas: { 2026: ['2026-10-12'], 2027: ['2027-10-12'], 2028: ['2028-10-12'] } },
  { id: 'finados', nome: '🕯️ Finados', datas: { 2026: ['2026-11-02'], 2027: ['2027-11-02'], 2028: ['2028-11-02'] } },
  { id: 'consciencia', nome: '✊ Consciência Negra', datas: { 2026: ['2026-11-20'], 2027: ['2027-11-20'], 2028: ['2028-11-20'] } },
  { id: 'natal', nome: '🎄 Natal', datas: { 2026: ['2026-12-25'], 2027: ['2027-12-25'], 2028: ['2028-12-25'] } }
];

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const OFFSET_PARA_SABADO = [-1, -2, -3, 3, 2, 1, 0]; // dom, seg, ter, qua, qui, sex, sáb
function sabadoDoFeriado(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + OFFSET_PARA_SABADO[d.getDay()]);
  return isoLocal(d);
}

const MAPA_FERIADO_PARA_SABADO = {};
const SABADOS_FERIADAO = new Map(); // sábado -> [ids dos feriadões]
FERIADOS.forEach(f => {
  f.sabados = {};
  Object.entries(f.datas).forEach(([ano, datas]) => {
    f.sabados[ano] = [...new Set(datas.map(sabadoDoFeriado))];
    datas.forEach(d => { MAPA_FERIADO_PARA_SABADO[d] = sabadoDoFeriado(d); });
    f.sabados[ano].forEach(s => SABADOS_FERIADAO.set(s, [...(SABADOS_FERIADAO.get(s) || []), f.id]));
  });
});


const CORES = {
  PLANTAO: '#10b981',
  FOLGA: '#3b82f6',
  FERIAS: '#f59e0b',
  AFASTAMENTO: '#a855f7',
  FERIADO: '#ef4444'
};

// ---- Padronização de nomes: "luisa", "Luísa " e "LUÍSA" viram um único nome (o mais usado) ----
const chaveNome = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
let nomesPendentes = []; // registros do banco com grafia diferente da canônica

function nomeCanonico(raw) {
  const k = chaveNome(raw), cont = {};
  todosEventos.forEach(e => { if (e.pessoa && chaveNome(e.pessoa) === k) cont[e.pessoa] = (cont[e.pessoa] || 0) + 1; });
  const mais = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  return mais ? mais[0] : String(raw).trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1));
}

function normalizarNomesLocais() {
  const cont = {};
  todosEventos.forEach(e => {
    if (!e.pessoa) return;
    const k = chaveNome(e.pessoa);
    cont[k] = cont[k] || {};
    cont[k][e.pessoa.trim()] = (cont[k][e.pessoa.trim()] || 0) + 1;
  });
  const canon = {};
  Object.entries(cont).forEach(([k, v]) => { canon[k] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]; });
  nomesPendentes = [];
  const vistos = new Set();
  todosEventos = todosEventos.filter(e => {
    if (e.pessoa) {
      const c = canon[chaveNome(e.pessoa)];
      if (e.pessoa !== c) { if (e.id && !String(e.id).startsWith('temp-')) nomesPendentes.push({ id: e.id, pessoa: c }); e.pessoa = c; }
      const chave = `${e.pessoa}|${e.data}|${e.tipo}`;
      if (vistos.has(chave)) return false; // duplicado exato: ignora na tela
      vistos.add(chave);
    }
    return true;
  });
}

function validarRegistro(p, idIgnorar) {
  const av = [], outros = todosEventos.filter(e => e.id !== idIgnorar && e.pessoa === p.pessoa && e.data === p.data);
  const ausencia = ['FOLGA', 'FERIAS', 'AFASTAMENTO'];
  if (p.tipo === 'PLANTAO' && new Date(p.data + 'T12:00:00').getDay() !== 6) av.push('o plantão da fono é aos sábados e esta data não é sábado');
  if (outros.some(e => e.tipo === p.tipo)) av.push('já existe um registro igual para esta pessoa neste dia');
  if (p.tipo === 'PLANTAO' && outros.some(e => ausencia.includes(e.tipo))) av.push('a pessoa já tem folga/férias/afastamento neste dia');
  if (ausencia.includes(p.tipo) && outros.some(e => e.tipo === 'PLANTAO')) av.push('a pessoa já tem plantão neste dia');
  return av;
}

function atualizarBoxFeriadao(marcadoPadrao) {
  const box = document.getElementById('boxFeriadao'), chk = document.getElementById('inputFeriadao');
  const dataVal = document.getElementById('inputData').value;
  const ids = dataVal ? SABADOS_FERIADAO.get(ajustarDataParaSabado(dataVal)) : null;
  const ok = ids && document.getElementById('inputTipo').value === 'PLANTAO';
  box.classList.toggle('hidden', !ok);
  if (ok) {
    document.getElementById('textoFeriadao').textContent = ids.map(id => FERIADOS.find(f => f.id === id).nome).join(' / ');
    if (marcadoPadrao !== undefined) chk.checked = marcadoPadrao;
  } else chk.checked = false;
}

function baixarBackup() {
  const limpo = todosEventos.map(({ id, ...r }) => r);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(limpo, null, 2)], { type: 'application/json' }));
  a.download = `backup_escala_${isoLocal(new Date())}.json`;
  a.click();
}

document.addEventListener('DOMContentLoaded', () => {
  carregarCacheLocal();
  inicializarCalendario();
  escutarFirebase();
  configurarEventosUI();
});

function ajustarDataParaSabado(dataOriginal) {
  return MAPA_FERIADO_PARA_SABADO[dataOriginal] || dataOriginal;
}

function carregarCacheLocal() {
  const localData = localStorage.getItem('escalas_backup_local');
  if (localData) {
    try { 
      todosEventos = JSON.parse(localData); normalizarNomesLocais(); 
      todosEventos.forEach(ev => {
        if (ev.tipo === 'PLANTAO') ev.data = ajustarDataParaSabado(ev.data);
      });
    } catch (e) {}
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
    dayCellClassNames: (arg) => SABADOS_FERIADAO.has(isoLocal(arg.date)) ? ['fc-sabado-feriadao'] : [],
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
      todosEventos = snapshot.docs.map(docSnap => {
        const d = docSnap.data();
        if (d.tipo === 'PLANTAO') d.data = ajustarDataParaSabado(d.data);
        return { id: docSnap.id, ...d };
      });
      normalizarNomesLocais();
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

  feriadosAutoMap.forEach((feriado, date) => {
    feriadosPorData.set(date, feriado);
  });

  const fcEvents = [];
  const chavesPessoasVistas = new Set();

  todosEventos.forEach(ev => {
    if (!ev.data) return;

    if (ev.tipo === 'PLANTAO') {
      ev.data = ajustarDataParaSabado(ev.data);
    }

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
          title: `${ev.pessoa} (${obterRotulo(ev.tipo)})${ev.feriadao ? ' ⭐' : ''}`,
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

function obterPlantonistasFeriadao(regra, ano) {
  const sabs = regra.sabados[ano] || [];
  const doSabado = todosEventos.filter(ev => ev.tipo === 'PLANTAO' && ev.pessoa && sabs.includes(ev.data));
  const rodizio = [...new Set(doSabado.filter(ev => ev.feriadao === regra.id).map(ev => ev.pessoa))].sort();
  const outros = [...new Set(doSabado.map(ev => ev.pessoa))].filter(n => !rodizio.includes(n)).sort();
  return { rodizio, outros };
}

function atualizarRanking() {
  const el = document.getElementById('rankingRodizio');
  if (!el) return;
  const cont = {}, cats = {};
  todosEventos.forEach(ev => {
    if (ev.pessoa && ev.categoria === 'Preceptora') cats[ev.pessoa] = true;
    if (ev.tipo === 'PLANTAO' && ev.feriadao && ev.pessoa) cont[ev.pessoa] = (cont[ev.pessoa] || 0) + 1;
  });
  const lista = Object.keys(cats).map(n => [n, cont[n] || 0]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  if (!lista.length) { el.innerHTML = ''; return; }
  const min = lista[0][1];
  el.innerHTML = `<div class="text-xs font-semibold text-slate-600 mb-2">Feriadões trabalhados (todos os anos). Quem tem menos tende a ser a próxima do rodízio:</div>` +
    lista.map(([n, q]) => `<span class="inline-flex items-center gap-1 m-0.5 px-2 py-1 rounded text-xs font-semibold ${q === min ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}">${n} <b>${q}</b></span>`).join('') +
    `<div class="text-[11px] text-slate-400 mt-2">Só conta plantões marcados como "plantão do feriadão". Se alguém não registrou, o número fica menor que o real.</div>`;
}

function atualizarTabelaFeriadoes() {
  const corpo = document.getElementById('corpoTabelaFeriadoes');
  if (!corpo) return;
  const sel = document.getElementById('selectAnoFeriadao');
  const a1 = Number(sel ? sel.value : 2026), a2 = a1 + 1;
  document.getElementById('thAno1').textContent = a1;
  document.getElementById('thAno2').textContent = a2;
  corpo.innerHTML = '';
  atualizarRanking();

  FERIADOS.forEach(regra => {
    const p1 = obterPlantonistasFeriadao(regra, a1), p2 = obterPlantonistasFeriadao(regra, a2);
    const repetidos = p1.rodizio.filter(p => p2.rodizio.includes(p));
    let status = '<span class="bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-full text-xs">✅ Rodízio OK</span>';
    if (repetidos.length) status = `<span class="bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full text-xs">⚠️ Repetição: ${repetidos.join(', ')}</span>`;
    else if (!p1.rodizio.length && !p2.rodizio.length) status = '<span class="bg-slate-100 text-slate-500 text-xs italic px-2 py-1 rounded">Sem registro de rodízio</span>';
    const cob = ano => (regra.sabados[ano] || []).map(s => formatarDatas([s])).join(', ');
    const feriados = ano => (regra.datas[ano] || []).map(d => formatarDatas([d])).join(', ');
    const celula = (p, cor) => renderBadgesPessoas(p.rodizio, cor) +
      (p.outros.length ? `<div class="text-[11px] text-slate-400 mt-1">Também no sábado: ${p.outros.join(', ')}</div>` : '');

    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 hover:bg-slate-50 transition';
    tr.innerHTML = `
      <td class="p-3 border-r border-slate-200 font-semibold text-slate-800">${regra.nome}</td>
      <td class="p-3 border-r border-slate-200 text-xs text-slate-600">
        <div><b>${a1}:</b> sábado ${cob(a1)} <span class="text-slate-400">(feriado ${feriados(a1)})</span></div>
        <div><b>${a2}:</b> sábado ${cob(a2) || '-'} <span class="text-slate-400">(feriado ${feriados(a2) || '-'})</span></div>
      </td>
      <td class="p-3 border-r border-slate-200 bg-emerald-50/50">${celula(p1, 'emerald')}</td>
      <td class="p-3 border-r border-slate-200 bg-blue-50/50">${celula(p2, 'blue')}</td>
      <td class="p-3">${status}</td>`;
    corpo.appendChild(tr);
  });
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
  atualizarBoxFeriadao(true);
  document.getElementById('modalTitulo').textContent = 'Marcar Registro na Escala';
  document.getElementById('btnExcluir').classList.add('hidden');
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Salvar';
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
  atualizarBoxFeriadao(Boolean(dados.feriadao));

  document.getElementById('modalTitulo').textContent = 'Editar Registro';
  document.getElementById('btnExcluir').classList.remove('hidden');
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Salvar';
  }
  modal.classList.remove('hidden');
}

function fecharModal() {
  modal.classList.add('hidden');
  form.reset();
  if (btnSubmit) {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Salvar';
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

  document.getElementById('btnNovoRegistro').addEventListener('click', () => abrirModalNovaData(isoLocal(new Date())));
  document.getElementById('btnFecharModal').addEventListener('click', fecharModal);

  document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltrosEAtualizar);
  document.getElementById('filtroPessoa').addEventListener('change', aplicarFiltrosEAtualizar);

  ['inputData', 'inputTipo'].forEach(id => document.getElementById(id).addEventListener('change', () => atualizarBoxFeriadao(true)));
  document.getElementById('selectAnoFeriadao').addEventListener('change', atualizarTabelaFeriadoes);
  document.getElementById('btnBackup').addEventListener('click', baixarBackup);
  document.getElementById('btnImprimir').addEventListener('click', () => window.print());
  if (location.search.includes('admin')) document.getElementById('adminTools').classList.remove('hidden');
  document.getElementById('btnPadronizar').addEventListener('click', padronizarNomesNoBanco);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const nomeDigitado = document.getElementById('inputPessoa').value.trim();
    const dataDigitada = document.getElementById('inputData').value;
    if (!nomeDigitado || !dataDigitada) {
      alert('Preencha o nome do profissional e a data.');
      return;
    }

    const tipo = document.getElementById('inputTipo').value;
    const pessoaVal = nomeCanonico(nomeDigitado);
    let dataVal = tipo === 'PLANTAO' ? ajustarDataParaSabado(dataDigitada) : dataDigitada;
    const ids = SABADOS_FERIADAO.get(dataVal);
    const marcouFeriadao = tipo === 'PLANTAO' && ids && document.getElementById('inputFeriadao').checked;

    const payload = {
      pessoa: pessoaVal,
      categoria: document.getElementById('inputCategoria').value.trim() || 'Geral',
      tipo,
      data: dataVal,
      cargaHoraria: Number(document.getElementById('inputCH').value) || 2,
      observacao: document.getElementById('inputObs').value.trim(),
      feriadao: marcouFeriadao ? ids[0] : '',
      atualizadoEm: new Date().toISOString()
    };

    const isEdit = Boolean(idEdicaoAtual);
    const targetId = idEdicaoAtual;

    const avisos = validarRegistro(payload, targetId);
    if (avisos.length && !confirm('Atenção:\n- ' + avisos.join('\n- ') + '\n\nSalvar mesmo assim?')) return;

    fecharModal();
    const extra = (dataVal !== dataDigitada ? ` (movido para o sábado ${formatarDatas([dataVal])})` : '') +
                  (pessoaVal !== nomeDigitado ? ` (nome ajustado para "${pessoaVal}")` : '');
    mostrarToast((isEdit ? '✅ Registro atualizado' : '✅ Registro salvo') + extra);

    if (isEdit) {
      const idx = todosEventos.findIndex(x => x.id === targetId);
      if (idx !== -1) todosEventos[idx] = { id: targetId, ...payload };
    } else {
      todosEventos.push({ id: 'temp-' + Date.now(), ...payload });
    }

    salvarCacheLocal();
    aplicarFiltrosEAtualizar();
    atualizarListasDinamicas();
    atualizarTabelaFeriadoes();

    if (isEdit && !targetId.startsWith('temp-')) {
      updateDoc(doc(db, 'escalas', targetId), payload).catch(err => console.error('Erro Firebase:', err));
    } else {
      addDoc(collection(db, 'escalas'), payload).catch(err => console.error('Erro Firebase:', err));
    }
  });

  document.getElementById('btnExcluir').addEventListener('click', async () => {
    if (confirm('Deseja realmente excluir este registro?')) {
      const idParaRemover = idEdicaoAtual;
      todosEventos = todosEventos.filter(x => x.id !== idParaRemover);
      salvarCacheLocal();
      aplicarFiltrosEAtualizar();
      atualizarTabelaFeriadoes();
      fecharModal();
      mostrarToast('🗑️ Registro excluído com sucesso.');

      try {
        if (idParaRemover && !idParaRemover.startsWith('temp-')) {
          await deleteDoc(doc(db, 'escalas', idParaRemover));
        }
      } catch (e) {}
    }
  });

  document.getElementById('btnImportarDados').addEventListener('click', importarDadosIniciais);
}

async function emLotes(itens, tamanho, acao) {
  // Firestore aceita no máximo 500 operações por batch
  for (let i = 0; i < itens.length; i += tamanho) {
    const b = writeBatch(db);
    itens.slice(i, i + tamanho).forEach(it => acao(b, it));
    await b.commit();
  }
}

async function padronizarNomesNoBanco() {
  if (!nomesPendentes.length) return alert('Nenhum nome para padronizar.');
  if (!confirm(`Corrigir a grafia do nome em ${nomesPendentes.length} registro(s) no banco?`)) return;
  await emLotes(nomesPendentes, 400, (b, p) => b.update(doc(db, 'escalas', p.id), { pessoa: p.pessoa }));
  mostrarToast('✅ Nomes padronizados.');
}

async function importarDadosIniciais() {
  const btn = document.getElementById('btnImportarDados');
  if (!confirm('ATENÇÃO: isto APAGA todos os registros atuais e recarrega o dados_iniciais.json.\nUm backup será baixado antes. Continuar?')) return;
  baixarBackup();

  btn.disabled = true;
  btn.textContent = '⏳ Importando...';
  try {
    const res = await fetch('dados_iniciais.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('dados_iniciais.json não encontrado');
    const dados = await res.json();
    dados.forEach(item => { if (item.tipo === 'PLANTAO') item.data = ajustarDataParaSabado(item.data); });

    const snapshot = await getDocs(collection(db, 'escalas'));
    await emLotes(snapshot.docs, 400, (b, d) => b.delete(doc(db, 'escalas', d.id)));
    localStorage.removeItem('escalas_backup_local');
    todosEventos = [];
    await emLotes(dados, 400, (b, item) => b.set(doc(collection(db, 'escalas')), item));

    mostrarToast(`✅ ${dados.length} registros importados.`);
  } catch (err) {
    alert('Erro na importação: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Carregar Dados Iniciais';
  }
}
