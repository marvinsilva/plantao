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
let idsLote = null;      // ids dos registros diários de um período de férias/afastamento em edição
let minhaAplicada = false;

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
  const ign = [].concat(idIgnorar || []);
  const av = [], outros = todosEventos.filter(e => !ign.includes(e.id) && e.pessoa === p.pessoa && e.data === p.data);
  const ausencia = ['FOLGA', 'FERIAS', 'AFASTAMENTO'];
  if (p.tipo === 'PLANTAO' && new Date(p.data + 'T12:00:00').getDay() !== 6) av.push('o plantão da fono é aos sábados e esta data não é sábado');
  if (outros.some(e => e.tipo === p.tipo)) av.push('já existe um registro igual para esta pessoa neste dia');
  if (p.tipo === 'PLANTAO' && outros.some(e => ausencia.includes(e.tipo))) av.push('a pessoa já tem folga/férias/afastamento neste dia');
  if (ausencia.includes(p.tipo) && outros.some(e => e.tipo === 'PLANTAO')) av.push('a pessoa já tem plantão neste dia');
  return av;
}

function atualizarBoxFeriadao(marcadoPadrao) {
  document.getElementById('boxDataFim').classList.toggle('hidden', !['FERIAS', 'AFASTAMENTO'].includes(document.getElementById('inputTipo').value));
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

function somaDia(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoLocal(d); }
function listaDias(ini, fim) { const r = []; for (let d = ini; d <= fim && r.length < 400; d = somaDia(d, 1)) r.push(d); return r; }

// Junta dias seguidos da mesma pessoa/tipo/observação em um único período
function agruparPeriodos(registros) {
  const grupos = {}, saida = [];
  registros.forEach(ev => { (grupos[`${ev.pessoa}|${ev.tipo}|${ev.observacao || ''}`] = grupos[`${ev.pessoa}|${ev.tipo}|${ev.observacao || ''}`] || []).push(ev); });
  Object.values(grupos).forEach(lista => {
    lista.sort((a, b) => a.data.localeCompare(b.data));
    let atual = null;
    lista.forEach(ev => {
      if (atual && somaDia(atual.fim, 1) === ev.data) { atual.fim = ev.data; atual.ids.push(ev.id); }
      else { atual = { base: ev, inicio: ev.data, fim: ev.data, ids: [ev.id] }; saida.push(atual); }
    });
  });
  return saida;
}

function renderMinhaEscala() {
  const el = document.getElementById('minhaEscala'), sel = document.getElementById('selMinhaPessoa');
  if (!el || !sel) return;
  const nome = sel.value;
  if (!nome) { el.innerHTML = '<p class="text-xs text-slate-400 italic">Escolha seu nome para ver só a sua escala.</p>'; return; }
  const hoje = isoLocal(new Date()), ano = hoje.slice(0, 4);
  const plantoes = todosEventos.filter(e => e.pessoa === nome && e.tipo === 'PLANTAO');
  const doAno = plantoes.filter(e => e.data.startsWith(ano));
  const prox = plantoes.filter(e => e.data >= hoje).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 5);
  const dias = d => Math.round((new Date(d + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
  const sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  el.innerHTML = `<div class="text-xs text-slate-500 mb-2">${doAno.length} plantões em ${ano} · ${doAno.filter(e => e.feriadao).length} ⭐ feriadão(ões)</div>` +
    (prox.length ? prox.map(e => `<div class="flex justify-between py-1 border-b border-slate-100 text-xs"><span class="font-semibold">${sem[new Date(e.data + 'T12:00:00').getDay()]} ${formatarDatas([e.data])}${e.feriadao ? ' ⭐' : ''}</span><span class="text-slate-500">${dias(e.data) === 0 ? 'hoje' : 'em ' + dias(e.data) + ' d'}</span></div>`).join('')
      : '<p class="text-xs text-slate-400 italic">Nenhum plantão futuro registrado.</p>');
}

function atualizarUrlPessoa(nome) {
  const u = new URL(location.href);
  if (nome && nome !== 'TODAS') u.searchParams.set('pessoa', nome); else u.searchParams.delete('pessoa');
  history.replaceState(null, '', u);
}

async function salvarPeriodo(payload, dias, idsAntigos) {
  todosEventos = todosEventos.filter(x => !idsAntigos.includes(x.id));
  dias.forEach(d => todosEventos.push({ id: 'temp-' + d + '-' + Math.random().toString(36).slice(2, 6), ...payload, data: d }));
  salvarCacheLocal(); aplicarFiltrosEAtualizar(); atualizarListasDinamicas(); atualizarTabelaFeriadoes();
  mostrarToast(`✅ Período salvo (${dias.length} dia${dias.length > 1 ? 's' : ''})`);
  const ops = [...idsAntigos.filter(i => !String(i).startsWith('temp-')).map(id => ({ del: id })), ...dias.map(d => ({ dados: { ...payload, data: d } }))];
  try {
    await emLotes(ops, 400, (b, op) => op.del ? b.delete(doc(db, 'escalas', op.del)) : b.set(doc(collection(db, 'escalas')), op.dados));
  } catch (e) { alert('Não foi possível salvar no servidor: ' + e.message); }
}

const ORDEM_TIPO = { PLANTAO: 1, FOLGA: 2, FERIAS: 3, AFASTAMENTO: 4 };
const ordemEv = x => { const p = x.extendedProps || x; return p.isFeriadoAuto ? 0 : (ORDEM_TIPO[p.tipo] ?? 9); };
const ROTULO_CURTO = { FOLGA: 'folga', FERIAS: 'férias', AFASTAMENTO: 'afast.' };

function tiposVisiveis() {
  const marcados = [...document.querySelectorAll('.chk-tipo:checked')];
  return document.querySelector('.chk-tipo') ? marcados.flatMap(c => c.value.split(',')) : Object.keys(ORDEM_TIPO);
}

function aplicarTema(escuro) {
  document.documentElement.classList.toggle('dark', escuro);
  const b = document.getElementById('btnTema');
  if (b) b.textContent = escuro ? '☀️ Claro' : '🌙 Escuro';
}

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
    initialView: window.innerWidth < 640 ? 'listMonth' : 'dayGridMonth',
    height: 'auto',
    dayMaxEvents: 5,
    moreLinkText: n => `+${n}`,
    moreLinkClick: 'popover',
    eventOrder: (a, b) => ordemEv(a) - ordemEv(b) || String(a.title).localeCompare(String(b.title)),
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

  const selMinha = document.getElementById('selMinhaPessoa');
  if (selMinha) {
    const v = selMinha.value;
    selMinha.innerHTML = '<option value="">Escolha seu nome</option>' + pessoasUnicas.map(p => `<option value="${p}">${p}</option>`).join('');
    selMinha.value = v;
    if (!minhaAplicada && pessoasUnicas.length) {
      minhaAplicada = true;
      let desejado = new URLSearchParams(location.search).get('pessoa');
      try { desejado = desejado || localStorage.getItem('minhaPessoa'); } catch (e) {}
      const achado = pessoasUnicas.find(p => chaveNome(p) === chaveNome(desejado));
      if (achado) { selMinha.value = achado; document.getElementById('filtroPessoa').value = achado; }
    }
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
  const periodos = [];
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
    const matchTipo = tiposVisiveis().includes(ev.tipo);

    if (matchCat && matchPessoa && matchTipo) {
      const chaveUnica = `${ev.pessoa}_${ev.data}_${ev.tipo}`;
      if (!chavesPessoasVistas.has(chaveUnica)) {
        chavesPessoasVistas.add(chaveUnica);
        if (ev.tipo === 'FERIAS' || ev.tipo === 'AFASTAMENTO') { periodos.push(ev); return; }
        fcEvents.push({
          id: ev.id,
          title: ev.tipo === 'PLANTAO' ? `${ev.pessoa}${ev.feriadao ? ' ⭐' : ''}` : `${ev.pessoa} · ${ROTULO_CURTO[ev.tipo] || obterRotulo(ev.tipo)}`,
          start: ev.data,
          backgroundColor: CORES[ev.tipo] || '#64748b',
          classNames: ['ev-' + String(ev.tipo).toLowerCase()],
          extendedProps: ev
        });
      }
    }
  });

  agruparPeriodos(periodos).forEach(p => {
    const t = p.base.tipo;
    fcEvents.push({
      id: 'periodo-' + p.ids[0],
      title: `${p.base.pessoa} · ${t === 'FERIAS' ? 'férias' : (p.base.observacao || 'afast.')}`,
      start: p.inicio, end: somaDia(p.fim, 1), allDay: true,
      backgroundColor: CORES[t], classNames: ['ev-' + t.toLowerCase()],
      extendedProps: { ...p.base, data: p.inicio, inicio: p.inicio, fim: p.fim, ids: p.ids }
    });
  });

  const listaFeriadosUnicos = Array.from(feriadosPorData.values());
  const todosEventosCalendario = [...fcEvents, ...listaFeriadosUnicos];

  if (calendar) {
    calendar.removeAllEventSources();
    calendar.addEventSource(todosEventosCalendario);
  }
  atualizarContadores();
  renderMinhaEscala();
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
  const el = document.getElementById('listaContadores');
  if (!el || !calendar) return;
  const ref = calendar.getDate(), mes = ref.getMonth(), ano = ref.getFullYear();
  const vistos = new Set(), porPessoa = {}, porSabado = {};
  todosEventos.forEach(ev => {
    if (ev.tipo !== 'PLANTAO' || !ev.pessoa || !ev.data) return;
    const d = new Date(ev.data + 'T12:00:00');
    if (d.getMonth() !== mes || d.getFullYear() !== ano || vistos.has(ev.pessoa + ev.data)) return;
    vistos.add(ev.pessoa + ev.data);
    const p = porPessoa[ev.pessoa] = porPessoa[ev.pessoa] || { q: 0, fer: 0 };
    p.q++; if (ev.feriadao) p.fer++;
    porSabado[ev.data] = (porSabado[ev.data] || 0) + 1;
  });
  const pessoas = Object.entries(porPessoa).sort((a, b) => b[1].q - a[1].q || a[0].localeCompare(b[0]));
  if (!pessoas.length) { el.innerHTML = '<p class="text-slate-400 italic">Nenhum plantão neste mês.</p>'; return; }
  const max = pessoas[0][1].q, sabados = Object.entries(porSabado).sort();
  el.innerHTML = `
    <div class="flex items-baseline gap-2 mb-3"><span class="text-3xl font-bold text-emerald-600">${vistos.size}</span><span class="text-xs text-slate-500">plantões em ${sabados.length} sábado(s)</span></div>
    <div class="space-y-2 mb-4">${pessoas.map(([n, v]) => `
      <div><div class="flex justify-between text-xs mb-0.5"><span class="font-medium">${n}</span><span class="text-slate-500">${v.q}${v.fer ? ` · ${v.fer} ⭐` : ''}</span></div>
      <div class="h-2 rounded bg-slate-100"><div class="h-2 rounded bg-emerald-500" style="width:${Math.round(v.q / max * 100)}%"></div></div></div>`).join('')}</div>
    <div class="text-xs font-semibold text-slate-500 mb-1">Sábados do mês (dia · pessoas)</div>
    <div class="flex flex-wrap gap-1">${sabados.map(([d, q]) => { const f = SABADOS_FERIADAO.has(d); return `<span class="px-2 py-1 rounded text-xs font-semibold ${f ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">${d.slice(8)} · ${q}${f ? ' ⭐' : ''}</span>`; }).join('')}</div>`;
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
  idsLote = null;
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
  const dados = fcEvent.extendedProps;
  idsLote = dados.ids || null;
  idEdicaoAtual = idsLote ? idsLote[0] : fcEvent.id;

  document.getElementById('inputPessoa').value = dados.pessoa || '';
  document.getElementById('inputCategoria').value = dados.categoria || '';
  document.getElementById('inputTipo').value = dados.tipo || 'PLANTAO';
  document.getElementById('inputData').value = dados.data || '';
  document.getElementById('inputDataFim').value = (dados.fim && dados.fim !== dados.data) ? dados.fim : '';
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

  document.getElementById('selMinhaPessoa').addEventListener('change', (e) => {
    const nome = e.target.value;
    try { localStorage.setItem('minhaPessoa', nome); } catch (err) {}
    document.getElementById('filtroPessoa').value = nome || 'TODAS';
    atualizarUrlPessoa(nome);
    aplicarFiltrosEAtualizar();
  });
  document.getElementById('filtroPessoa').addEventListener('change', (e) => atualizarUrlPessoa(e.target.value));

  document.querySelectorAll('.chk-tipo').forEach(c => c.addEventListener('change', aplicarFiltrosEAtualizar));

  aplicarTema(document.documentElement.classList.contains('dark'));
  document.getElementById('btnTema').addEventListener('click', () => {
    const escuro = !document.documentElement.classList.contains('dark');
    aplicarTema(escuro);
    try { localStorage.setItem('tema', escuro ? 'dark' : 'light'); } catch (e) {}
  });

  configurarFeedback();

  document.getElementById('btnAmpliar').addEventListener('click', (ev) => {
    const amplo = document.getElementById('visaoCalendario').classList.toggle('modo-amplo');
    ev.currentTarget.textContent = amplo ? '⇱ Mostrar filtros' : '⛶ Ampliar calendário';
    setTimeout(() => calendar && calendar.updateSize(), 50);
  });

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

    const fimVal = document.getElementById('inputDataFim').value;
    const dias = (['FERIAS', 'AFASTAMENTO'].includes(tipo) && fimVal > dataVal) ? listaDias(dataVal, fimVal) : [dataVal];
    const avisos = [...new Set(dias.flatMap(d => validarRegistro({ ...payload, data: d }, idsLote || targetId)))];
    if (avisos.length && !confirm('Atenção:\n- ' + avisos.join('\n- ') + '\n\nSalvar mesmo assim?')) return;

    fecharModal();
    if (dias.length > 1 || idsLote) { salvarPeriodo(payload, dias, idsLote || (isEdit ? [targetId] : [])); return; }
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
      const idsRemover = idsLote || [idEdicaoAtual];
      todosEventos = todosEventos.filter(x => !idsRemover.includes(x.id));
      salvarCacheLocal();
      aplicarFiltrosEAtualizar();
      atualizarTabelaFeriadoes();
      fecharModal();
      mostrarToast('🗑️ Registro excluído com sucesso.');

      try {
        await emLotes(idsRemover.filter(i => i && !String(i).startsWith('temp-')), 400, (b, id) => b.delete(doc(db, 'escalas', id)));
      } catch (e) {}
    }
  });

  document.getElementById('btnImportarDados').addEventListener('click', importarDadosIniciais);
}

// ================= Sugestões e bugs (coleção "feedback") =================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIPOS_FB = { IDEIA: '💡 Ideia', BUG: '🐞 Bug', AVISO: '📢 Aviso/dúvida' };
const STATUS_FB = { novo: 'Novo', andamento: 'Em andamento', feito: 'Resolvido', descartado: 'Descartado' };
let feedbacks = [];

function abrirFeedback() {
  document.getElementById('formFeedback').reset();
  try { document.getElementById('fbNome').value = localStorage.getItem('minhaPessoa') || ''; } catch (e) {}
  document.getElementById('modalFeedback').classList.remove('hidden');
  document.getElementById('fbMensagem').focus();
}

async function enviarFeedback(e) {
  e.preventDefault();
  const msg = document.getElementById('fbMensagem').value.trim();
  if (msg.length < 5) return alert('Escreva um pouco mais para eu entender.');
  let ultimo = 0;
  try { ultimo = Number(localStorage.getItem('fbUltimo')) || 0; } catch (err) {}
  if (Date.now() - ultimo < 30000) return alert('Aguarde alguns segundos antes de enviar outra mensagem.');
  const btn = document.getElementById('fbEnviar');
  btn.disabled = true;
  try {
    await addDoc(collection(db, 'feedback'), {
      tipo: document.getElementById('fbTipo').value,
      mensagem: msg.slice(0, 1000),
      nome: document.getElementById('fbNome').value.trim().slice(0, 60),
      status: 'novo',
      criadoEm: new Date().toISOString(),
      tela: `${innerWidth}x${innerHeight}`,
      tema: document.documentElement.classList.contains('dark') ? 'escuro' : 'claro',
      navegador: navigator.userAgent.slice(0, 140)
    });
    try { localStorage.setItem('fbUltimo', String(Date.now())); } catch (err) {}
    document.getElementById('modalFeedback').classList.add('hidden');
    mostrarToast('✅ Obrigado! Sua mensagem foi enviada.');
  } catch (err) {
    alert('Não foi possível enviar agora: ' + err.message);
  } finally { btn.disabled = false; }
}

async function carregarFeedbacks() {
  const snap = await getDocs(collection(db, 'feedback'));
  feedbacks = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const n = feedbacks.filter(f => (f.status || 'novo') === 'novo').length;
  document.getElementById('btnVerFeedback').textContent = `📬 Sugestões${n ? ` (${n})` : ''}`;
}

function feedbacksFiltrados() {
  const f = document.getElementById('fbFiltroStatus').value;
  return feedbacks.filter(x => f === 'TODOS' || (x.status || 'novo') === f);
}

function renderListaFeedback() {
  const lista = feedbacksFiltrados();
  document.getElementById('fbLista').innerHTML = lista.length ? lista.map(f => `
    <div class="border border-slate-200 rounded p-3 text-sm space-y-2" data-id="${esc(f.id)}">
      <div class="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span><b class="text-slate-700">${TIPOS_FB[f.tipo] || esc(f.tipo)}</b> · ${esc(f.nome) || 'anônimo'} · ${new Date(f.criadoEm).toLocaleString('pt-BR')}</span>
        <span>${esc(f.tela)} · ${esc(f.tema)}</span>
      </div>
      <p class="whitespace-pre-wrap">${esc(f.mensagem)}</p>
      <div class="flex justify-between items-center">
        <select class="fb-status border border-slate-300 rounded px-2 py-1 text-xs bg-white">
          ${Object.entries(STATUS_FB).map(([k, v]) => `<option value="${k}" ${(f.status || 'novo') === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button type="button" class="fb-del text-xs text-red-500 hover:text-red-700 font-semibold">Excluir</button>
      </div>
    </div>`).join('') : '<p class="text-slate-400 italic text-sm">Nenhuma mensagem aqui.</p>';
}

async function abrirListaFeedback() {
  try { await carregarFeedbacks(); } catch (e) { return alert('Não foi possível ler as sugestões (confira as regras do Firestore): ' + e.message); }
  renderListaFeedback();
  document.getElementById('modalFeedbackLista').classList.remove('hidden');
}

function configurarFeedback() {
  document.getElementById('btnFeedback').addEventListener('click', abrirFeedback);
  document.getElementById('formFeedback').addEventListener('submit', enviarFeedback);
  document.querySelectorAll('.fb-fechar').forEach(b => b.addEventListener('click', () => b.closest('[data-modal]').classList.add('hidden')));
  document.getElementById('btnVerFeedback').addEventListener('click', abrirListaFeedback);
  document.getElementById('fbFiltroStatus').addEventListener('change', renderListaFeedback);
  document.getElementById('fbCopiar').addEventListener('click', async () => {
    const txt = feedbacksFiltrados().map(f => `[${TIPOS_FB[f.tipo] || f.tipo} | ${STATUS_FB[f.status || 'novo']} | ${f.nome || 'anônimo'} | ${new Date(f.criadoEm).toLocaleDateString('pt-BR')} | ${f.tela}/${f.tema}]\n${f.mensagem}`).join('\n\n');
    try { await navigator.clipboard.writeText(txt); mostrarToast('📋 Copiado.'); } catch (e) { alert('Não consegui copiar.'); }
  });
  document.getElementById('fbLista').addEventListener('change', async (ev) => {
    if (!ev.target.classList.contains('fb-status')) return;
    const id = ev.target.closest('[data-id]').dataset.id;
    try { await updateDoc(doc(db, 'feedback', id), { status: ev.target.value }); const f = feedbacks.find(x => x.id === id); if (f) f.status = ev.target.value; carregarFeedbacks(); }
    catch (e) { alert('Erro ao atualizar: ' + e.message); }
  });
  document.getElementById('fbLista').addEventListener('click', async (ev) => {
    if (!ev.target.classList.contains('fb-del') || !confirm('Excluir esta mensagem?')) return;
    const id = ev.target.closest('[data-id]').dataset.id;
    try { await deleteDoc(doc(db, 'feedback', id)); feedbacks = feedbacks.filter(x => x.id !== id); renderListaFeedback(); carregarFeedbacks(); }
    catch (e) { alert('Erro ao excluir: ' + e.message); }
  });
  if (location.search.includes('admin')) carregarFeedbacks().catch(() => {});
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
