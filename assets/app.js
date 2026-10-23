/* Painel estático SUSEP/SES alimentado por dados/*.json.
   Reproduz, no navegador, os quatro blocos do painel Streamlit: ramos,
   ranking/concentração, evolução/sazonalidade e resseguro/previdência. */

(() => {
  'use strict';

  // ------------------------------------------------------------- paleta --
  const COR = {
    azul: '#002363',
    azulMedio: '#33538C',
    azulClaro: '#7A94C4',
    azulLavado: '#E4EAF4',
    magenta: '#D70064',
    magentaClara: '#F48FB1',
    cinza: '#5A6472',
    linha: '#E4E8F0',
    grade: '#EDF0F6'
  };
  const ESCALA_AZUL = ['#E4EAF4', '#9DB0CE', COR.azulMedio, COR.azul];
  const ESCALA_MAGENTA = ['#FBE1EB', COR.magentaClara, COR.magenta, '#8E0041'];
  const ESCALA_DIVERGENTE = [COR.azul, '#FFFFFF', COR.magenta];

  // Métricas exportadas em cada tabela de fato.
  const NUMERICAS = [
    'premio_direto', 'premio_ganho', 'sinistro_ocorrido', 'despesa_comercial',
    'despesa_resseguro', 'receita_resseguro', 'premio_emitido',
    'premio_emitido_cap', 'rvne', 'convenio_dpvat', 'consorcios_fundos'
  ];

  // ---------------------------------------------------------- formatação --
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  const fmt = {
    moeda: (v) => (v == null || Number.isNaN(v) ? '–' : 'R$ ' + nf2.format(v)),
    curto: (v) => {
      if (v == null || Number.isNaN(v)) return '–';
      const abs = Math.abs(v);
      if (abs >= 1e9) return 'R$ ' + nf2.format(v / 1e9) + ' bi';
      if (abs >= 1e6) return 'R$ ' + nf2.format(v / 1e6) + ' mi';
      if (abs >= 1e3) return 'R$ ' + nf2.format(v / 1e3) + ' mil';
      return 'R$ ' + nf2.format(v);
    },
    mi: (v) => nf2.format(v / 1e6),
    pct: (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(d).replace('.', ',') + '%'),
    inteiro: (v) => nf0.format(v),
    mes: (c) => (c && String(c).length === 6 ? String(c).slice(4, 6) + '/' + String(c).slice(0, 4) : String(c ?? '–'))
  };

  // ---------------------------------------------------------- plotly ----- */
  const EIXO = {
    showgrid: true, gridcolor: COR.grade, gridwidth: 1, zeroline: false,
    linecolor: COR.linha, ticks: 'outside', tickcolor: COR.linha,
    tickfont: { color: '#8A93A3', size: 11 }, automargin: true
  };
  const BASE_LAYOUT = {
    font: { family: 'IBM Plex Sans, Segoe UI, sans-serif', size: 12, color: COR.cinza },
    separators: ',.',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    colorway: [COR.azul, COR.magenta, COR.azulMedio, COR.magentaClara, COR.cinza],
    margin: { l: 6, r: 14, t: 10, b: 6 },
    xaxis: Object.assign({}, EIXO),
    yaxis: Object.assign({}, EIXO),
    legend: { orientation: 'h', x: 0, y: 1.14, bgcolor: 'rgba(0,0,0,0)', font: { size: 11 }, itemwidth: 30 },
    hoverlabel: {
      bgcolor: '#FFFFFF', bordercolor: COR.linha,
      font: { family: 'IBM Plex Mono, monospace', size: 12, color: COR.azul }
    },
    bargap: 0.28
  };
  const CONFIG = { displayModeBar: false, responsive: true };

  const plotlyOk = () => typeof window.Plotly !== 'undefined';

  function desenhar(id, traces, layout) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!plotlyOk()) {
      el.innerHTML = '<p class="nota">Não foi possível carregar a biblioteca de gráficos. Verifique a conexão e recarregue a página.</p>';
      return;
    }
    window.Plotly.react(el, traces, Object.assign({}, BASE_LAYOUT, layout), CONFIG);
  }

  function vazio(id, texto) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<p class="nota">${texto}</p>`;
  }

  const alturaBarras = (n) => Math.max(320, n * 27 + 96);

  // ---------------------------------------------------------- estado ----- */
  const estado = {
    aba: 'ramos',
    empresas: new Set(),
    busca: '',
    escopoRanking: 'mercado',
    ramoRanking: null,
    topRamos: 15,
    topRanking: 15,
    periodoIni: null,
    periodoFim: null
  };

  let D = null;

  // ------------------------------------------------------- carregamento -- */
  async function lerJson(nome) {
    const resposta = await fetch('dados/' + nome, { cache: 'no-cache' });
    if (!resposta.ok) throw new Error(`${nome}: HTTP ${resposta.status}`);
    return resposta.json();
  }

  function emObjetos(tabela) {
    if (!tabela || !tabela.cols) return [];
    const { cols, rows } = tabela;
    return rows.map((linha) => {
      const objeto = {};
      for (let i = 0; i < cols.length; i += 1) objeto[cols[i]] = linha[i];
      return objeto;
    });
  }

  // ------------------------------------------------------------ helpers -- */
  const nomeEmpresa = (codigo) => (D.empresas.get(codigo) || codigo);
  const nomeRamo = (codigo) => (D.ramos.get(codigo) || codigo);
  const competenciasDe = (linhas) => [...new Set(linhas.map((l) => String(l.competencia)))].sort();

  function filtrarEmpresas(linhas) {
    if (!estado.empresas.size) return linhas;
    return linhas.filter((l) => estado.empresas.has(l.codigo_empresa));
  }

  function agrupar(linhas, extrair) {
    const mapa = new Map();
    for (const linha of linhas) {
      const chave = extrair(linha).chave;
      let alvo = mapa.get(chave);
      if (!alvo) {
        alvo = Object.assign({}, extrair(linha).rotulos);
        for (const metrica of NUMERICAS) alvo[metrica] = 0;
        mapa.set(chave, alvo);
      }
      for (const metrica of NUMERICAS) alvo[metrica] += Number(linha[metrica] || 0);
    }
    return [...mapa.values()];
  }

  const porRamo = (linhas) => agrupar(linhas, (l) => ({
    chave: l.codigo_ramo,
    rotulos: { codigo_ramo: l.codigo_ramo, nome_ramo: nomeRamo(l.codigo_ramo) }
  }));

  const porEmpresa = (linhas) => agrupar(linhas, (l) => ({
    chave: l.codigo_empresa,
    rotulos: { codigo_empresa: l.codigo_empresa, nome_empresa: nomeEmpresa(l.codigo_empresa) }
  }));

  const porEmpresaRamo = (linhas) => agrupar(linhas, (l) => ({
    chave: `${l.codigo_empresa}|${l.codigo_ramo}`,
    rotulos: {
      codigo_empresa: l.codigo_empresa,
      nome_empresa: nomeEmpresa(l.codigo_empresa),
      codigo_ramo: l.codigo_ramo,
      nome_ramo: nomeRamo(l.codigo_ramo)
    }
  }));

  const porEmpresaCompetencia = (linhas) => agrupar(linhas, (l) => ({
    chave: `${l.codigo_empresa}|${l.competencia}`,
    rotulos: {
      codigo_empresa: l.codigo_empresa,
      nome_empresa: nomeEmpresa(l.codigo_empresa),
      competencia: l.competencia
    }
  }));

  const empresasSelecionadas = () => [...estado.empresas]
    .sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b), 'pt-BR'));

  function comSinistralidade(linhas) {
    for (const linha of linhas) {
      const premio = Number(linha.premio_ganho || 0);
      linha.sin_calc = premio ? (Number(linha.sinistro_ocorrido || 0) / premio) * 100 : null;
    }
    return linhas;
  }

  /** Fonte por ramo: cruzamento empresa x ramo quando há filtro; senão a marginal. */
  function fonteRamo() {
    if (estado.empresas.size && D.empresaRamo.length) {
      return { linhas: filtrarEmpresas(D.empresaRamo), cruzamento: true };
    }
    return { linhas: D.ramoMes, cruzamento: false };
  }

  /** Fonte mensal: empresa x mês (filtrado) ou ramo x mês. */
  function fonteMensal() {
    return estado.empresas.size ? filtrarEmpresas(D.empresaMes) : D.ramoMes;
  }

  function definirTituloGrafico(id, texto) {
    const alvo = document.getElementById(id);
    const titulo = alvo && alvo.previousElementSibling;
    if (titulo && titulo.classList && titulo.classList.contains('cartao__titulo')) {
      titulo.textContent = texto;
    }
  }

  // ------------------------------------------------- filtro de período -- */
  const janelaInteira = () =>
    estado.periodoIni === D.competencias[0] && estado.periodoFim === D.competencias[D.competencias.length - 1];

  const periodoAtivo = () =>
    D.competencias.filter((competencia) => competencia >= estado.periodoIni && competencia <= estado.periodoFim);

  /** Recorta qualquer tabela mensal na janela escolhida na lateral. */
  function recortarPeriodo(linhas) {
    const ativo = new Set(periodoAtivo());
    if (ativo.size === D.competencias.length) return linhas;
    return linhas.filter((l) => ativo.has(String(l.competencia)));
  }

  function atualizarAjudaPeriodo() {
    const meses = periodoAtivo().length;
    const quantidade = meses === 1 ? '1 competência' : `${meses} competências`;
    document.getElementById('ajuda-periodo').textContent = janelaInteira()
      ? `Janela completa da base: ${quantidade}.`
      : `${fmt.mes(estado.periodoIni)} a ${fmt.mes(estado.periodoFim)} · ${quantidade}.`;
  }

  function preencherPeriodo() {
    const todas = D.competencias;
    if (!todas.length) return;
    if (!todas.includes(estado.periodoIni)) estado.periodoIni = todas[0];
    if (!todas.includes(estado.periodoFim)) estado.periodoFim = todas[todas.length - 1];
    const opcoes = todas.map((competencia) => `<option value="${competencia}">${fmt.mes(competencia)}</option>`).join('');
    for (const id of ['periodo-ini', 'periodo-fim']) {
      const select = document.getElementById(id);
      select.innerHTML = opcoes;
      select.value = id === 'periodo-ini' ? estado.periodoIni : estado.periodoFim;
    }
    atualizarAjudaPeriodo();
  }

  function ajustarPeriodo(evento) {
    const inicial = document.getElementById('periodo-ini');
    const final = document.getElementById('periodo-fim');
    if (inicial.value > final.value) {
      if (evento.target === inicial) final.value = inicial.value;
      else inicial.value = final.value;
    }
    estado.periodoIni = inicial.value;
    estado.periodoFim = final.value;
    atualizarAjudaPeriodo();
    renderAtiva();
  }

  // ------------------------------------------------------------ tabelas -- */
  function formatarCelula(valor, coluna) {
    if (valor == null || valor === '') return '–';
    if (coluna.tipo === 'moeda') return fmt.moeda(valor);
    if (coluna.tipo === 'pct') return fmt.pct(valor, coluna.decimais ?? 2);
    if (coluna.tipo === 'inteiro') return fmt.inteiro(valor);
    return String(valor);
  }

  function tabelaHtml(colunas, linhas) {
    const cabecalho = colunas
      .map((c) => `<th class="${c.tipo === 'texto' ? '' : 'num'}">${c.rotulo}</th>`)
      .join('');
    const corpo = linhas
      .map((linha) => '<tr>' + colunas.map((c) => {
        const valor = linha[c.chave];
        const classe = c.classe ? c.classe(valor, linha) : (c.tipo === 'texto' ? '' : 'num');
        return `<td class="${classe}">${formatarCelula(valor, c)}</td>`;
      }).join('') + '</tr>')
      .join('');
    return `<table class="dados"><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table>`;
  }

  function pintarTabela(id, colunas, linhas, resumo) {
    const alvo = document.getElementById(id);
    if (!linhas.length) {
      alvo.innerHTML = '<p class="nota" style="padding:.9rem">Sem linhas para o recorte selecionado.</p>';
      return;
    }
    alvo.innerHTML = tabelaHtml(colunas, linhas);
    const contador = document.getElementById('c-' + id.replace('tabela-', ''));
    if (contador) contador.textContent = resumo || `${fmt.inteiro(linhas.length)} linhas`;
  }

  const classeSinistralidade = (valor) => {
    if (valor == null) return 'num';
    if (valor >= 100) return 'num destaque--alta';
    if (valor <= 50) return 'num destaque--baixa';
    return 'num';
  };

  // -------------------------------------------------------------- aviso -- */
  function atualizarAviso() {
    const aviso = document.getElementById('aviso-filtro');
    const total = estado.empresas.size;
    if (!total) {
      aviso.hidden = true;
      return;
    }
    let texto = estado.aba === 'ranking'
      ? `Filtro de empresa ativo: ${total} empresa(s) selecionada(s). HHI, CR4 e CR8 são calculados sobre o próprio recorte, e não sobre o mercado inteiro.`
      : `Filtro de empresa ativo: ${total} empresa(s) selecionada(s). Os indicadores por ramo vêm do cruzamento empresa × ramo e cobrem apenas os ramos coletados nesse escopo.`;
    if ((estado.aba === 'ramos' || estado.aba === 'estrutura') && !janelaInteira()) {
      texto += ' Esse cruzamento é acumulado em toda a janela coletada, então o filtro de período não altera os valores por ramo.';
    }
    aviso.textContent = texto;
    aviso.hidden = false;
  }

  // -------------------------------------------------------------- aba 1 -- */
  function renderRamos() {
    const fonte = fonteRamo();
    if (!fonte.linhas.length) {
      vazio('g-ramos-mix', 'Sem dados de ramo para este recorte.');
      return;
    }
    // O cruzamento empresa × ramo vem acumulado na janela inteira, então não
    // responde ao filtro de período.
    const linhasRecorte = fonte.cruzamento ? fonte.linhas : recortarPeriodo(fonte.linhas);
    const compararEmpresas = fonte.cruzamento && estado.empresas.size > 1;
    const base = comSinistralidade(porRamo(linhasRecorte))
      .sort((a, b) => b.premio_direto - a.premio_direto);

    const premio = base.reduce((s, l) => s + l.premio_direto, 0);
    const sinistro = base.reduce((s, l) => s + l.sinistro_ocorrido, 0);
    const premioGanho = base.reduce((s, l) => s + l.premio_ganho, 0);
    const sinistralidade = premioGanho ? (sinistro / premioGanho) * 100 : null;

    document.getElementById('k-ramos-premio').textContent = fmt.curto(premio);
    document.getElementById('k-ramos-sinistro').textContent = fmt.curto(sinistro);
    document.getElementById('k-ramos-sinistralidade').textContent = fmt.pct(sinistralidade);
    document.getElementById('k-ramos-ativos').textContent = fmt.inteiro(base.filter((l) => l.premio_direto > 0).length);

    const n = estado.topRamos;
    const topo = base.slice(0, n);

    if (compararEmpresas) {
      const empresas = empresasSelecionadas();
      const baseEmpresaRamo = comSinistralidade(porEmpresaRamo(linhasRecorte))
        .sort((a, b) => b.premio_direto - a.premio_direto);
      const indiceEmpresaRamo = new Map(
        baseEmpresaRamo.map((linha) => [`${linha.codigo_empresa}|${linha.codigo_ramo}`, linha])
      );
      const ramosTop = base.slice(0, Math.min(n, 10));
      const baseEmpresa = comSinistralidade(porEmpresa(linhasRecorte))
        .filter((l) => l.premio_direto > 0)
        .sort((a, b) => b.premio_direto - a.premio_direto);

      document.getElementById('t-ramos-mix').textContent =
        `Comparativo dos principais ramos por empresa selecionada`;
      definirTituloGrafico('g-ramos-dispersao', 'Empresas selecionadas: porte x sinistralidade');
      definirTituloGrafico('g-ramos-sinistralidade', 'Sinistralidade por empresa selecionada');

      desenhar('g-ramos-mix',
        empresas.map((codigo) => ({
          type: 'bar',
          orientation: 'h',
          name: nomeEmpresa(codigo),
          x: ramosTop.map((ramo) => (indiceEmpresaRamo.get(`${codigo}|${ramo.codigo_ramo}`)?.premio_direto || 0) / 1e6),
          y: ramosTop.map((ramo) => ramo.nome_ramo),
          customdata: ramosTop.map((ramo) => [
            fmt.moeda(indiceEmpresaRamo.get(`${codigo}|${ramo.codigo_ramo}`)?.premio_direto || 0)
          ]),
          hovertemplate: '<b>%{fullData.name}</b><br>%{y}<br>Prêmio direto: %{customdata[0]}<extra></extra>'
        })),
        {
          barmode: 'group',
          height: alturaBarras(ramosTop.length),
          margin: { l: 6, r: 14, t: 10, b: 34 },
          yaxis: Object.assign({}, EIXO, { autorange: 'reversed', tickfont: { size: 11, color: COR.cinza } }),
          xaxis: Object.assign({}, EIXO, { title: { text: 'Prêmio direto (R$ milhões)', font: { size: 11, color: '#8A93A3' } } })
        }
      );

      const maiorPremioEmpresa = Math.max(...baseEmpresa.map((l) => l.premio_direto), 1);
      desenhar('g-ramos-dispersao', [{
        type: 'scatter',
        mode: 'markers+text',
        x: baseEmpresa.map((l) => l.premio_direto / 1e6),
        y: baseEmpresa.map((l) => l.sin_calc),
        text: baseEmpresa.map((l) => l.nome_empresa),
        textposition: 'top center',
        textfont: { size: 10, color: COR.azul, family: 'IBM Plex Sans, sans-serif' },
        marker: {
          size: baseEmpresa.map((l) => l.premio_direto),
          sizemode: 'area',
          sizeref: (2 * maiorPremioEmpresa) / (48 * 48),
          color: baseEmpresa.map((_, indice) => indice),
          colorscale: ESCALA_AZUL,
          line: { color: '#FFFFFF', width: 1.2 },
          opacity: 0.9,
          showscale: false
        },
        customdata: baseEmpresa.map((l) => [l.nome_empresa, fmt.moeda(l.premio_direto), fmt.pct(l.sin_calc)]),
        hovertemplate: '<b>%{customdata[0]}</b><br>Prêmio direto: %{customdata[1]}<br>Sinistralidade: %{customdata[2]}<extra></extra>'
      }], {
        height: Math.max(360, empresas.length * 36 + 180),
        xaxis: Object.assign({}, EIXO, { title: { text: 'Prêmio direto (R$ milhões)', font: { size: 11, color: '#8A93A3' } } }),
        yaxis: Object.assign({}, EIXO, { title: { text: 'Sinistralidade (%)', font: { size: 11, color: '#8A93A3' } } })
      });

      const empresasSin = baseEmpresa
        .filter((l) => l.sin_calc != null)
        .sort((a, b) => b.sin_calc - a.sin_calc)
        .reverse();
      desenhar('g-ramos-sinistralidade', [{
        type: 'bar',
        orientation: 'h',
        x: empresasSin.map((l) => l.sin_calc),
        y: empresasSin.map((l) => l.nome_empresa),
        marker: { color: empresasSin.map((l) => l.sin_calc), colorscale: ESCALA_MAGENTA, showscale: false },
        customdata: empresasSin.map((l) => [fmt.pct(l.sin_calc), fmt.moeda(l.premio_ganho)]),
        hovertemplate: '%{y}<br>Sinistralidade: %{customdata[0]}<br>Prêmio ganho: %{customdata[1]}<extra></extra>'
      }], {
        height: Math.max(320, empresasSin.length * 34 + 110),
        margin: { l: 6, r: 14, t: 10, b: 34 },
        yaxis: Object.assign({}, EIXO, { tickfont: { size: 11, color: COR.cinza } }),
        xaxis: Object.assign({}, EIXO, { ticksuffix: '%' })
      });

      const colunasComparacao = [
        { chave: 'nome_empresa', rotulo: 'Empresa', tipo: 'texto' },
        { chave: 'nome_ramo', rotulo: 'Ramo', tipo: 'texto' },
        { chave: 'premio_direto', rotulo: 'Prêmio direto', tipo: 'moeda' },
        { chave: 'premio_ganho', rotulo: 'Prêmio ganho', tipo: 'moeda' },
        { chave: 'sinistro_ocorrido', rotulo: 'Sinistro ocorrido', tipo: 'moeda' },
        { chave: 'sin_calc', rotulo: 'Sinistralidade', tipo: 'pct', classe: (v) => classeSinistralidade(v) }
      ];
      pintarTabela(
        'tabela-ramos',
        colunasComparacao,
        baseEmpresaRamo,
        `${fmt.inteiro(baseEmpresaRamo.length)} combinações empresa × ramo`
      );
      return;
    }

    document.getElementById('t-ramos-mix').textContent =
      `Top ${n} ramos em ${fmt.mes(selecionadas[selecionadas.length - 1])}${selecionadas.length > 1 ? ' (acumulado ' + selecionadas.length + ' meses)' : ''}`;
    definirTituloGrafico('g-ramos-dispersao', 'Sinistralidade × porte do ramo');
    definirTituloGrafico('g-ramos-sinistralidade', 'Ramos com maior sinistralidade');

    desenhar('g-ramos-mix', [
      {
        type: 'bar', orientation: 'h', name: 'Prêmio direto',
        x: topo.map((l) => l.premio_direto / 1e6), y: topo.map((l) => l.nome_ramo),
        marker: { color: COR.azul },
        customdata: topo.map((l) => [fmt.moeda(l.premio_direto)]),
        hovertemplate: '%{y}<br>Prêmio direto: %{customdata[0]}<extra></extra>'
      },
      {
        type: 'bar', orientation: 'h', name: 'Sinistro ocorrido',
        x: topo.map((l) => l.sinistro_ocorrido / 1e6), y: topo.map((l) => l.nome_ramo),
        marker: { color: COR.magenta },
        customdata: topo.map((l) => [fmt.moeda(l.sinistro_ocorrido)]),
        hovertemplate: '%{y}<br>Sinistro ocorrido: %{customdata[0]}<extra></extra>'
      }
    ], {
      barmode: 'group', height: alturaBarras(n),
      margin: { l: 6, r: 14, t: 10, b: 34 },
      yaxis: Object.assign({}, EIXO, { autorange: 'reversed', tickfont: { size: 11, color: COR.cinza } }),
      xaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } })
    });

    const dispersao = topo.filter((l) => l.sin_calc != null);
    const maiorPremio = Math.max(...dispersao.map((l) => l.premio_direto), 1);
    desenhar('g-ramos-dispersao', [{
      type: 'scatter', mode: 'markers+text',
      x: dispersao.map((l) => l.premio_direto / 1e6),
      y: dispersao.map((l) => l.sin_calc),
      text: dispersao.map((l) => l.codigo_ramo),
      textposition: 'top center',
      textfont: { size: 9, color: '#8A93A3', family: 'IBM Plex Mono, monospace' },
      marker: {
        size: dispersao.map((l) => l.premio_direto),
        sizemode: 'area',
        sizeref: (2 * maiorPremio) / (44 * 44),
        color: dispersao.map((l) => l.sin_calc),
        colorscale: ESCALA_MAGENTA,
        line: { color: '#FFFFFF', width: 1.2 },
        opacity: 0.88,
        colorbar: { title: { text: '%', font: { size: 10 } }, thickness: 10, len: 0.7, outlinewidth: 0 }
      },
      customdata: dispersao.map((l) => [l.nome_ramo, fmt.moeda(l.premio_direto), fmt.pct(l.sin_calc)]),
      hovertemplate: '<b>%{customdata[0]}</b><br>Prêmio direto: %{customdata[1]}<br>Sinistralidade: %{customdata[2]}<extra></extra>'
    }], {
      height: alturaBarras(n),
      xaxis: Object.assign({}, EIXO, { title: { text: 'Prêmio direto (R$ milhões)', font: { size: 11, color: '#8A93A3' } } }),
      yaxis: Object.assign({}, EIXO, { title: { text: 'Sinistralidade (%)', font: { size: 11, color: '#8A93A3' } } })
    });

    const ordenado = base.filter((l) => l.sin_calc != null)
      .sort((a, b) => b.sin_calc - a.sin_calc).slice(0, 20).reverse();
    desenhar('g-ramos-sinistralidade', [{
      type: 'bar', orientation: 'h',
      x: ordenado.map((l) => l.sin_calc), y: ordenado.map((l) => l.nome_ramo),
      marker: { color: ordenado.map((l) => l.sin_calc), colorscale: ESCALA_MAGENTA, showscale: false },
      customdata: ordenado.map((l) => [fmt.pct(l.sin_calc), fmt.moeda(l.premio_ganho)]),
      hovertemplate: '%{y}<br>Sinistralidade: %{customdata[0]}<br>Prêmio ganho: %{customdata[1]}<extra></extra>'
    }], {
      height: Math.max(360, ordenado.length * 25 + 90),
      margin: { l: 6, r: 14, t: 10, b: 34 },
      yaxis: Object.assign({}, EIXO, { tickfont: { size: 11, color: COR.cinza } }),
      xaxis: Object.assign({}, EIXO, { ticksuffix: '%' })
    });

    const colunas = [
      { chave: 'codigo_ramo', rotulo: 'Código', tipo: 'texto' },
      { chave: 'nome_ramo', rotulo: 'Ramo', tipo: 'texto' },
      { chave: 'premio_direto', rotulo: 'Prêmio direto', tipo: 'moeda' },
      { chave: 'premio_ganho', rotulo: 'Prêmio ganho', tipo: 'moeda' },
      { chave: 'sinistro_ocorrido', rotulo: 'Sinistro ocorrido', tipo: 'moeda' },
      { chave: 'despesa_comercial', rotulo: 'Despesa comercial', tipo: 'moeda' },
      { chave: 'sin_calc', rotulo: 'Sinistralidade', tipo: 'pct', classe: (v) => classeSinistralidade(v) }
    ];
    pintarTabela('tabela-ramos', colunas, base,
      `${fmt.inteiro(base.length)} ramos · ${fmt.mes(selecionadas[0])}${selecionadas.length > 1 ? '–' + fmt.mes(selecionadas[selecionadas.length - 1]) : ''}`);
  }

  // -------------------------------------------------------------- aba 2 -- */
  function renderRanking() {
    const porRamoEscopo = estado.escopoRanking === 'ramo';
    document.getElementById('controle-ramo-ranking').hidden = !porRamoEscopo;

    let linhas;
    if (porRamoEscopo) {
      if (!D.empresaRamo.length) {
        vazio('g-rank-empresas', 'O cruzamento empresa × ramo não está disponível nesta base.');
        return;
      }
      linhas = filtrarEmpresas(D.empresaRamo);
      const ramos = [...new Set(linhas.map((l) => l.codigo_ramo))]
        .map((codigo) => ({ codigo, nome: nomeRamo(codigo) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      if (!ramos.length) {
        vazio('g-rank-empresas', 'Nenhuma empresa do filtro tem dados de ramo.');
        return;
      }
      const select = document.getElementById('ramo-ranking');
      if (!ramos.some((r) => r.codigo === estado.ramoRanking)) estado.ramoRanking = ramos[0].codigo;
      select.innerHTML = ramos
        .map((r) => `<option value="${r.codigo}">${r.codigo} - ${r.nome}</option>`)
        .join('');
      select.value = estado.ramoRanking;
      linhas = linhas.filter((l) => l.codigo_ramo === estado.ramoRanking);
    } else {
      linhas = filtrarEmpresas(D.empresaMes);
    }

    if (!linhas.length) {
      vazio('g-rank-empresas', 'Sem dados para o recorte selecionado.');
      return;
    }
    // No escopo por ramo a fonte é o cruzamento acumulado da janela inteira.
    const linhasRecorte = porRamoEscopo ? linhas : recortarPeriodo(linhas);

    const base = comSinistralidade(porEmpresa(linhasRecorte))
      .filter((l) => l.premio_direto > 0)
      .sort((a, b) => b.premio_direto - a.premio_direto);
    if (!base.length) {
      vazio('g-rank-empresas', 'Nenhuma empresa com prêmio no recorte selecionado.');
      return;
    }

    const total = base.reduce((s, l) => s + l.premio_direto, 0);
    for (const linha of base) linha.participacao = (linha.premio_direto / total) * 100;
    const hhi = base.reduce((s, l) => s + Math.pow(l.participacao / 100, 2), 0) * 10000;
    const cr4 = base.slice(0, 4).reduce((s, l) => s + l.participacao, 0);
    const cr8 = base.slice(0, 8).reduce((s, l) => s + l.participacao, 0);

    document.getElementById('k-rank-empresas').textContent = fmt.inteiro(base.length);
    document.getElementById('k-rank-hhi').textContent = fmt.inteiro(hhi);
    document.getElementById('k-rank-cr4').textContent = fmt.pct(cr4);
    document.getElementById('k-rank-cr8').textContent = fmt.pct(cr8);

    const n = Math.min(estado.topRanking, base.length);
    const topo = base.slice(0, n).reverse();
    const plural = (quantidade) => (quantidade === 1 ? 'empresa' : 'empresas');
    const escopoRanking = porRamoEscopo
      ? nomeRamo(estado.ramoRanking)
      : (estado.empresas.size ? 'recorte filtrado' : 'mercado total');
    document.getElementById('t-rank-empresas').textContent = porRamoEscopo
      ? `Top ${n} ${plural(n)} em ${nomeRamo(estado.ramoRanking)}`
      : `Top ${n} ${plural(n)} por prêmio direto`;

    desenhar('g-rank-empresas', [{
      type: 'bar', orientation: 'h',
      x: topo.map((l) => l.premio_direto / 1e6), y: topo.map((l) => l.nome_empresa),
      text: topo.map((l) => fmt.pct(l.participacao, 2)),
      textposition: 'outside', cliponaxis: false,
      textfont: { size: 10, family: 'IBM Plex Mono, monospace', color: COR.azul },
      marker: { color: COR.azul },
      customdata: topo.map((l) => [fmt.moeda(l.premio_direto), fmt.pct(l.participacao, 2)]),
      hovertemplate: '<b>%{y}</b><br>Prêmio direto: %{customdata[0]}<br>Participação: %{customdata[1]}<extra></extra>'
    }], {
      height: alturaBarras(n),
      margin: { l: 6, r: 52, t: 10, b: 34 },
      yaxis: Object.assign({}, EIXO, { tickfont: { size: 11, color: COR.cinza } }),
      xaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } })
    });

    let acumulado = 0;
    const curva = base.map((l) => { acumulado += l.participacao; return acumulado; });
    const traces = [{
      type: 'scatter', mode: 'lines', fill: 'tozeroy', name: 'Participação acumulada',
      x: base.map((_, i) => i + 1), y: curva,
      line: { color: COR.magenta, width: 2.5 }, fillcolor: 'rgba(215,0,100,.14)',
      hovertemplate: '%{x} empresas<br>Acumulado: %{y:.2f}%<extra></extra>'
    }];
    const tracos = [];
    [[4, cr4, 'CR4'], [8, cr8, 'CR8']].forEach(([posicao, valor, rotulo]) => {
      if (base.length >= posicao) {
        traces.push({ type: 'scatter', mode: 'markers', x: [posicao], y: [valor], marker: { color: COR.magenta, size: 8 }, showlegend: false, hoverinfo: 'skip' });
        tracos.push({ x: posicao, y: valor, text: `${rotulo} = ${fmt.pct(valor)}`, showarrow: true, arrowhead: 0, ax: 26, ay: -26, font: { size: 10, color: COR.azul, family: 'IBM Plex Mono, monospace' }, bgcolor: '#FFFFFF', bordercolor: COR.linha, borderwidth: 1 });
      }
    });
    desenhar('g-rank-concentracao', traces, {
      height: 460,
      margin: { l: 6, r: 14, t: 10, b: 34 },
      shapes: [[4, cr4], [8, cr8]].filter(([p]) => base.length >= p).map(([p]) => ({
        type: 'line', x0: p, x1: p, yref: 'paper', y0: 0, y1: 1,
        line: { color: COR.azulClaro, width: 1, dash: 'dot' }
      })),
      annotations: tracos,
      xaxis: Object.assign({}, EIXO, { title: { text: 'Número de empresas', font: { size: 11, color: '#8A93A3' } } }),
      yaxis: Object.assign({}, EIXO, { ticksuffix: '%', range: [0, 103] })
    });

    const colunas = [
      { chave: 'codigo_empresa', rotulo: 'Código', tipo: 'texto' },
      { chave: 'nome_empresa', rotulo: 'Empresa', tipo: 'texto' },
      { chave: 'premio_direto', rotulo: 'Prêmio direto', tipo: 'moeda' },
      { chave: 'sinistro_ocorrido', rotulo: 'Sinistro ocorrido', tipo: 'moeda' },
      { chave: 'sin_calc', rotulo: 'Sinistralidade', tipo: 'pct', classe: (v) => classeSinistralidade(v) },
      { chave: 'participacao', rotulo: 'Participação', tipo: 'pct', decimais: 2 }
    ];
    pintarTabela('tabela-ranking', colunas, base,
      `${fmt.inteiro(base.length)} ${plural(base.length)} · ${escopoRanking}`);
  }

  // -------------------------------------------------------------- aba 3 -- */
  function renderEvolucao() {
    const fonte = recortarPeriodo(fonteMensal());
    if (!fonte.length) {
      vazio('g-evolucao', 'Sem dados para a evolução temporal neste recorte.');
      return;
    }
    const compararEmpresas = estado.empresas.size > 1;
    const competencias = competenciasDe(fonte);
    const serie = competencias.map((competencia) => {
      const doMes = fonte.filter((l) => String(l.competencia) === competencia);
      const somar = (metrica) => doMes.reduce((s, l) => s + Number(l[metrica] || 0), 0);
      return {
        competencia,
        premio_direto: somar('premio_direto'),
        sinistro_ocorrido: somar('sinistro_ocorrido'),
        premio_ganho: somar('premio_ganho')
      };
    });
    comSinistralidade(serie);
    serie.forEach((linha, indice) => {
      linha.variacao = indice === 0 || !serie[indice - 1].premio_direto
        ? null
        : ((linha.premio_direto / serie[indice - 1].premio_direto) - 1) * 100;
    });
    const rotulos = serie.map((l) => fmt.mes(l.competencia));

    if (compararEmpresas) {
      const empresas = empresasSelecionadas();
      const baseEmpresaCompetencia = comSinistralidade(porEmpresaCompetencia(fonte));
      const indiceEmpresaCompetencia = new Map(
        baseEmpresaCompetencia.map((linha) => [`${linha.codigo_empresa}|${linha.competencia}`, linha])
      );
      const linhasTabela = [];

      definirTituloGrafico('g-evolucao', 'Evolução do prêmio direto por empresa');
      definirTituloGrafico('g-variacao', 'Variação mensal do prêmio por empresa');
      definirTituloGrafico('g-sazonalidade', 'Prêmio direto mensal por empresa (R$ milhões)');

      const tracesEvolucao = empresas.map((codigo) => {
        const serieEmpresa = competencias.map((competencia) => {
          const linha = indiceEmpresaCompetencia.get(`${codigo}|${competencia}`) || {
            codigo_empresa: codigo,
            nome_empresa: nomeEmpresa(codigo),
            competencia,
            premio_direto: 0,
            sinistro_ocorrido: 0,
            premio_ganho: 0,
            sin_calc: null
          };
          return Object.assign({}, linha);
        });
        comSinistralidade(serieEmpresa);
        serieEmpresa.forEach((linha, indice) => {
          linha.variacao = indice === 0 || !serieEmpresa[indice - 1].premio_direto
            ? null
            : ((linha.premio_direto / serieEmpresa[indice - 1].premio_direto) - 1) * 100;
          linhasTabela.push({
            competencia: fmt.mes(linha.competencia),
            nome_empresa: nomeEmpresa(codigo),
            premio_direto: linha.premio_direto,
            sinistro_ocorrido: linha.sinistro_ocorrido,
            sin_calc: linha.sin_calc,
            variacao: linha.variacao
          });
        });
        return {
          type: 'scatter',
          mode: 'lines+markers',
          name: nomeEmpresa(codigo),
          x: rotulos,
          y: serieEmpresa.map((l) => l.premio_direto / 1e6),
          customdata: serieEmpresa.map((l) => [fmt.moeda(l.premio_direto)]),
          hovertemplate: '<b>%{fullData.name}</b><br>%{x}<br>Prêmio direto: %{customdata[0]}<extra></extra>'
        };
      });

      desenhar('g-evolucao', tracesEvolucao, {
        height: 460,
        margin: { l: 6, r: 14, t: 10, b: 34 },
        xaxis: Object.assign({}, EIXO, { type: 'category' }),
        yaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } })
      });

      desenhar('g-variacao',
        empresas.map((codigo) => ({
          type: 'scatter',
          mode: 'lines+markers',
          name: nomeEmpresa(codigo),
          x: rotulos,
          y: competencias.map((competencia, indice) => {
            const atual = indiceEmpresaCompetencia.get(`${codigo}|${competencia}`)?.premio_direto || 0;
            if (indice === 0) return null;
            const anterior = indiceEmpresaCompetencia.get(`${codigo}|${competencias[indice - 1]}`)?.premio_direto || 0;
            return anterior ? ((atual / anterior) - 1) * 100 : null;
          }),
          hovertemplate: '<b>%{fullData.name}</b><br>%{x}<br>Variação: %{y:.2f}%<extra></extra>'
        })),
        {
          height: 360,
          margin: { l: 6, r: 14, t: 10, b: 34 },
          xaxis: Object.assign({}, EIXO, { type: 'category' }),
          yaxis: Object.assign({}, EIXO, { ticksuffix: '%' })
        }
      );

      desenhar('g-sazonalidade', [{
        type: 'heatmap',
        z: empresas.map((codigo) =>
          competencias.map((competencia) => (indiceEmpresaCompetencia.get(`${codigo}|${competencia}`)?.premio_direto || 0) / 1e6)
        ),
        x: rotulos,
        y: empresas.map((codigo) => nomeEmpresa(codigo)),
        colorscale: ESCALA_AZUL,
        text: empresas.map((codigo) =>
          competencias.map((competencia) => fmt.moeda(indiceEmpresaCompetencia.get(`${codigo}|${competencia}`)?.premio_direto || 0))
        ),
        hovertemplate: '%{y}<br>%{x}: %{text}<extra></extra>',
        colorbar: { title: { text: 'R$ mi', font: { size: 10 } }, thickness: 10, len: 0.8, outlinewidth: 0 },
        xgap: 2,
        ygap: 2
      }], {
        height: Math.max(300, empresas.length * 42 + 140),
        margin: { l: 6, r: 14, t: 10, b: 34 },
        xaxis: Object.assign({}, EIXO, { type: 'category', side: 'top' }),
        yaxis: Object.assign({}, EIXO, { autorange: 'reversed', tickfont: { size: 11, color: COR.cinza } })
      });

      const colunasComparacao = [
        { chave: 'competencia', rotulo: 'Competência', tipo: 'texto' },
        { chave: 'nome_empresa', rotulo: 'Empresa', tipo: 'texto' },
        { chave: 'premio_direto', rotulo: 'Prêmio direto', tipo: 'moeda' },
        { chave: 'sinistro_ocorrido', rotulo: 'Sinistro ocorrido', tipo: 'moeda' },
        { chave: 'sin_calc', rotulo: 'Sinistralidade', tipo: 'pct', classe: (v) => classeSinistralidade(v) },
        { chave: 'variacao', rotulo: 'Variação m/m', tipo: 'pct' }
      ];
      pintarTabela('tabela-serie', colunasComparacao, linhasTabela, `${fmt.inteiro(linhasTabela.length)} linhas comparativas`);
      return;
    }

    definirTituloGrafico('g-evolucao', 'Evolução mensal do prêmio, sinistro e sinistralidade');
    definirTituloGrafico('g-variacao', 'Variação do prêmio direto mês a mês');
    definirTituloGrafico('g-sazonalidade', 'Prêmio direto mensal por ramo (R$ milhões)');

    desenhar('g-evolucao', [
      {
        type: 'bar', name: 'Prêmio direto', x: rotulos, y: serie.map((l) => l.premio_direto / 1e6),
        marker: { color: COR.azul },
        customdata: serie.map((l) => [fmt.moeda(l.premio_direto)]),
        hovertemplate: '%{x}<br>Prêmio direto: %{customdata[0]}<extra></extra>'
      },
      {
        type: 'bar', name: 'Sinistro ocorrido', x: rotulos, y: serie.map((l) => l.sinistro_ocorrido / 1e6),
        marker: { color: COR.magenta },
        customdata: serie.map((l) => [fmt.moeda(l.sinistro_ocorrido)]),
        hovertemplate: '%{x}<br>Sinistro ocorrido: %{customdata[0]}<extra></extra>'
      },
      {
        type: 'scatter', mode: 'lines+markers', name: 'Sinistralidade (%)', x: rotulos,
        y: serie.map((l) => l.sin_calc), yaxis: 'y2',
        line: { color: COR.azulMedio, width: 3 }, marker: { size: 7, color: COR.azulMedio },
        customdata: serie.map((l) => [fmt.pct(l.sin_calc)]),
        hovertemplate: '%{x}<br>Sinistralidade: %{customdata[0]}<extra></extra>'
      }
    ], {
      barmode: 'group', height: 460,
      margin: { l: 6, r: 14, t: 10, b: 34 },
      xaxis: Object.assign({}, EIXO, { type: 'category' }),
      yaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } }),
      yaxis2: {
        overlaying: 'y', side: 'right', showgrid: false, zeroline: false,
        tickfont: { color: COR.azulMedio, size: 11 }, ticksuffix: '%',
        title: { text: 'Sinistralidade (%)', font: { size: 11, color: COR.azulMedio } }
      }
    });

    const comVariacao = serie.filter((l) => l.variacao != null);
    desenhar('g-variacao', [{
      type: 'bar', x: comVariacao.map((l) => fmt.mes(l.competencia)), y: comVariacao.map((l) => l.variacao),
      marker: { color: comVariacao.map((l) => l.variacao), colorscale: ESCALA_DIVERGENTE, cmid: 0, showscale: false },
      customdata: comVariacao.map((l) => [fmt.pct(l.variacao, 2)]),
      hovertemplate: '%{x}<br>Variação: %{customdata[0]}<extra></extra>'
    }], {
      height: 360,
      margin: { l: 6, r: 14, t: 10, b: 34 },
      xaxis: Object.assign({}, EIXO, { type: 'category' }),
      yaxis: Object.assign({}, EIXO, { ticksuffix: '%' })
    });

    const colunas = [
      { chave: 'competencia', rotulo: 'Competência', tipo: 'texto', classe: () => '' },
      { chave: 'premio_direto', rotulo: 'Prêmio direto', tipo: 'moeda' },
      { chave: 'sinistro_ocorrido', rotulo: 'Sinistro ocorrido', tipo: 'moeda' },
      { chave: 'sin_calc', rotulo: 'Sinistralidade', tipo: 'pct', classe: (v) => classeSinistralidade(v) },
      { chave: 'variacao', rotulo: 'Variação m/m', tipo: 'pct' }
    ];
    const linhaTabela = serie.map((l) => Object.assign({}, l, { competencia: fmt.mes(l.competencia) }));
    pintarTabela('tabela-serie', colunas, linhaTabela, `${fmt.inteiro(serie.length)} competências`);

    const ramo = fonteRamo();
    if (!ramo.linhas.length || !('codigo_ramo' in (ramo.linhas[0] || {}))) {
      vazio('g-sazonalidade', 'Sem dimensão de ramo neste recorte para montar o mapa de calor.');
      return;
    }
    const porRamoMes = porRamo(ramo.linhas);
    const maiores = [...porRamoMes].sort((a, b) => b.premio_direto - a.premio_direto).slice(0, 12);
    const meses = competenciasDe(ramo.linhas);
    const indice = new Map();
    for (const linha of ramo.linhas) indice.set(linha.codigo_ramo + '|' + linha.competencia, Number(linha.premio_direto || 0));
    const z = maiores.map((r) => meses.map((m) => (indice.get(r.codigo_ramo + '|' + m) || 0) / 1e6));

    const texto = maiores.map((r) => meses.map((m) => fmt.moeda(indice.get(r.codigo_ramo + '|' + m) || 0)));
    desenhar('g-sazonalidade', [{
      type: 'heatmap', z, x: meses.map(fmt.mes), y: maiores.map((r) => r.nome_ramo),
      colorscale: ESCALA_AZUL, text: texto, hovertemplate: '%{y}<br>%{x}: %{text}<extra></extra>',
      colorbar: { title: { text: 'R$ mi', font: { size: 10 } }, thickness: 10, len: 0.8, outlinewidth: 0 },
      xgap: 2, ygap: 2
    }], {
      height: Math.max(420, maiores.length * 30 + 130),
      margin: { l: 6, r: 14, t: 10, b: 34 },
      xaxis: Object.assign({}, EIXO, { type: 'category', side: 'top' }),
      yaxis: Object.assign({}, EIXO, { autorange: 'reversed', tickfont: { size: 11, color: COR.cinza } })
    });
  }

  // -------------------------------------------------------------- aba 4 -- */
  function renderEstrutura() {
    const fonte = fonteRamo();
    if (!fonte.linhas.length) {
      vazio('g-resseguro', 'Sem dados neste recorte. Verifique o filtro de empresa.');
      return;
    }
    const base = porRamo(fonte.cruzamento ? fonte.linhas : recortarPeriodo(fonte.linhas));
    const somar = (metrica) => base.reduce((s, l) => s + Number(l[metrica] || 0), 0);
    const premioGanho = somar('premio_ganho');
    const despesa = somar('despesa_resseguro');
    const receita = somar('receita_resseguro');
    const cedencia = premioGanho ? (despesa / premioGanho) * 100 : null;
    const recuperacao = premioGanho ? (receita / premioGanho) * 100 : null;

    document.getElementById('k-est-premio').textContent = fmt.curto(premioGanho);
    document.getElementById('k-est-despesa').textContent = fmt.curto(despesa);
    document.getElementById('k-est-cedencia').textContent = fmt.pct(cedencia);
    document.getElementById('k-est-recuperacao').textContent = fmt.pct(recuperacao);

    const maiores = [...base].sort((a, b) => b.premio_ganho - a.premio_ganho).slice(0, 15);
    desenhar('g-resseguro', [
      {
        type: 'bar', name: 'Prêmio ganho', x: maiores.map((l) => l.nome_ramo), y: maiores.map((l) => l.premio_ganho / 1e6),
        marker: { color: COR.azul },
        customdata: maiores.map((l) => [fmt.moeda(l.premio_ganho)]),
        hovertemplate: '%{x}<br>Prêmio ganho: %{customdata[0]}<extra></extra>'
      },
      {
        type: 'bar', name: 'Despesa com resseguro', x: maiores.map((l) => l.nome_ramo), y: maiores.map((l) => l.despesa_resseguro / 1e6),
        marker: { color: COR.magenta },
        customdata: maiores.map((l) => [fmt.moeda(l.despesa_resseguro)]),
        hovertemplate: '%{x}<br>Despesa com resseguro: %{customdata[0]}<extra></extra>'
      },
      {
        type: 'bar', name: 'Receita com resseguro', x: maiores.map((l) => l.nome_ramo), y: maiores.map((l) => l.receita_resseguro / 1e6),
        marker: { color: COR.azulClaro },
        customdata: maiores.map((l) => [fmt.moeda(l.receita_resseguro)]),
        hovertemplate: '%{x}<br>Receita com resseguro: %{customdata[0]}<extra></extra>'
      }
    ], {
      barmode: 'group', height: 520,
      margin: { l: 6, r: 14, t: 10, b: 96 },
      xaxis: Object.assign({}, EIXO, { type: 'category', tickangle: -40, tickfont: { size: 10, color: COR.cinza } }),
      yaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } })
    });

    const comCedencia = base.filter((l) => l.premio_ganho > 0 && l.despesa_resseguro > 0)
      .map((l) => Object.assign({}, l, { cedencia: (l.despesa_resseguro / l.premio_ganho) * 100 }))
      .sort((a, b) => b.premio_ganho - a.premio_ganho).slice(0, 15)
      .sort((a, b) => a.cedencia - b.cedencia);
    if (!comCedencia.length) {
      vazio('g-cedencia', 'Sem prêmio ganho e despesa de resseguro no recorte para calcular a cedência.');
    } else {
      desenhar('g-cedencia', [{
        type: 'bar', orientation: 'h',
        x: comCedencia.map((l) => l.cedencia), y: comCedencia.map((l) => l.nome_ramo),
        marker: { color: comCedencia.map((l) => l.cedencia), colorscale: ESCALA_MAGENTA, showscale: false },
        customdata: comCedencia.map((l) => [fmt.pct(l.cedencia), fmt.moeda(l.despesa_resseguro)]),
        hovertemplate: '%{y}<br>Cedência: %{customdata[0]}<br>Despesa: %{customdata[1]}<extra></extra>'
      }], {
        height: 520,
        margin: { l: 6, r: 14, t: 10, b: 34 },
        xaxis: Object.assign({}, EIXO, { ticksuffix: '%' }),
        yaxis: Object.assign({}, EIXO, { tickfont: { size: 11, color: COR.cinza } })
      });
    }

    const premioEmitido = somar('premio_emitido');
    const premioCap = somar('premio_emitido_cap');
    desenhar('g-donut', [{
      type: 'pie', hole: 0.55, sort: false,
      labels: ['Prêmio emitido (seguros)', 'Prêmio emitido (capitalização)'],
      values: [premioEmitido, premioCap],
      marker: { colors: [COR.azul, COR.magenta], line: { color: '#FFFFFF', width: 2 } },
      textinfo: 'percent', textfont: { size: 11, color: '#FFFFFF', family: 'IBM Plex Sans, sans-serif' },
      hovertemplate: '%{label}<br>%{customdata}<extra></extra>',
      customdata: [fmt.moeda(premioEmitido), fmt.moeda(premioCap)]
    }], { height: 400, showlegend: true });
    document.getElementById('nota-capitalizacao').textContent = premioEmitido
      ? `Peso da capitalização (previdência/VGBL): ${fmt.pct((premioCap / premioEmitido) * 100)} do prêmio emitido de seguros.`
      : '';

    const rotulosEspeciais = {
      convenio_dpvat: 'Convênio DPVAT',
      consorcios_fundos: 'Consórcios e fundos',
      rvne: 'RVNE'
    };
    const especiais = Object.entries(rotulosEspeciais)
      .map(([chave, rotulo]) => ({ rotulo, valor: somar(chave) }))
      .filter((item) => item.valor !== 0)
      .sort((a, b) => a.valor - b.valor);
    if (!especiais.length) {
      vazio('g-especiais', 'Sem valores nas linhas especiais no recorte selecionado.');
    } else {
      desenhar('g-especiais', [{
        type: 'bar', orientation: 'h',
        x: especiais.map((l) => l.valor / 1e6), y: especiais.map((l) => l.rotulo),
        marker: { color: especiais.map((l) => l.valor), colorscale: ESCALA_AZUL, showscale: false },
        customdata: especiais.map((l) => [fmt.moeda(l.valor)]),
        hovertemplate: '%{y}: %{customdata[0]}<extra></extra>'
      }], {
        height: 400,
        margin: { l: 6, r: 14, t: 10, b: 34 },
        xaxis: Object.assign({}, EIXO, { title: { text: 'R$ milhões', font: { size: 11, color: '#8A93A3' } } }),
        yaxis: Object.assign({}, EIXO, { tickfont: { size: 11, color: COR.cinza } })
      });
    }

    const colunas = [
      { chave: 'codigo_ramo', rotulo: 'Código', tipo: 'texto' },
      { chave: 'nome_ramo', rotulo: 'Ramo', tipo: 'texto' },
      { chave: 'premio_ganho', rotulo: 'Prêmio ganho', tipo: 'moeda' },
      { chave: 'despesa_resseguro', rotulo: 'Despesa resseguro', tipo: 'moeda' },
      { chave: 'receita_resseguro', rotulo: 'Receita resseguro', tipo: 'moeda' },
      { chave: 'premio_emitido_cap', rotulo: 'Prêmio capitalização', tipo: 'moeda' }
    ];
    pintarTabela('tabela-resseguro', colunas, [...base].sort((a, b) => b.premio_ganho - a.premio_ganho),
      `${fmt.inteiro(base.length)} ramos`);
  }

  // ------------------------------------------------------------ render --- */
  const RENDER = { ramos: renderRamos, ranking: renderRanking, evolucao: renderEvolucao, estrutura: renderEstrutura };

  function renderAtiva() {
    atualizarAviso();
    RENDER[estado.aba]();
  }

  function trocarAba(aba) {
    estado.aba = aba;
    document.querySelectorAll('.aba').forEach((botao) => {
      const ativo = botao.dataset.aba === aba;
      botao.setAttribute('aria-selected', String(ativo));
      botao.tabIndex = ativo ? 0 : -1;
      document.getElementById('painel-' + botao.dataset.aba).hidden = !ativo;
    });
    renderAtiva();
  }

  // ------------------------------------------------- filtro de empresas -- */
  function renderListaEmpresas() {
    const lista = document.getElementById('lista-empresas');
    const termo = estado.busca.trim().toLowerCase();
    const empresas = D.dimEmpresa
      .filter((e) => !termo
        || e.nome_empresa.toLowerCase().includes(termo)
        || String(e.codigo_empresa).includes(termo));
    if (!empresas.length) {
      lista.innerHTML = '<p class="caixa-empresas__vazio">Nenhuma empresa encontrada.</p>';
      return;
    }
    lista.innerHTML = empresas.map((e) => `
      <label class="opcao${estado.empresas.has(e.codigo_empresa) ? ' opcao--marcada' : ''}">
        <input type="checkbox" value="${e.codigo_empresa}" ${estado.empresas.has(e.codigo_empresa) ? 'checked' : ''}>
        <span>${e.nome_empresa}</span>
        <code>${e.codigo_empresa}</code>
      </label>`).join('');
  }

  function renderChips() {
    const chips = document.getElementById('chips-empresas');
    const selecionadas = [...estado.empresas].sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b), 'pt-BR'));
    chips.innerHTML = selecionadas.map((codigo) => `
      <span class="chip"><span>${nomeEmpresa(codigo)}</span>
        <button type="button" data-codigo="${codigo}" title="Remover ${nomeEmpresa(codigo)}" aria-label="Remover ${nomeEmpresa(codigo)}">&times;</button>
      </span>`).join('');
    const ajuda = document.getElementById('ajuda-empresas');
    ajuda.textContent = selecionadas.length
      ? `${selecionadas.length} empresa(s) selecionada(s). Vale para todas as seções.`
      : 'Seleção vazia = mercado inteiro.';
    document.getElementById('limpar-empresas').hidden = !selecionadas.length;
  }

  function ligarFiltros() {
    document.getElementById('busca-empresa').addEventListener('input', (evento) => {
      estado.busca = evento.target.value;
      renderListaEmpresas();
    });

    document.getElementById('lista-empresas').addEventListener('change', (evento) => {
      const caixa = evento.target;
      if (caixa.type !== 'checkbox') return;
      if (caixa.checked) estado.empresas.add(caixa.value);
      else estado.empresas.delete(caixa.value);
      caixa.closest('.opcao').classList.toggle('opcao--marcada', caixa.checked);
      renderChips();
      renderAtiva();
    });

    document.getElementById('chips-empresas').addEventListener('click', (evento) => {
      const botao = evento.target.closest('button[data-codigo]');
      if (!botao) return;
      estado.empresas.delete(botao.dataset.codigo);
      renderListaEmpresas();
      renderChips();
      renderAtiva();
    });

    document.getElementById('limpar-empresas').addEventListener('click', () => {
      estado.empresas.clear();
      renderListaEmpresas();
      renderChips();
      renderAtiva();
    });

    document.querySelectorAll('.aba').forEach((botao) => {
      botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
      botao.addEventListener('keydown', (evento) => {
        if (evento.key !== 'ArrowRight' && evento.key !== 'ArrowLeft') return;
        const abas = [...document.querySelectorAll('.aba')];
        const atual = abas.indexOf(botao);
        const proxima = abas[(atual + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
        proxima.focus();
        trocarAba(proxima.dataset.aba);
      });
    });

    document.getElementById('periodo-ini').addEventListener('change', ajustarPeriodo);
    document.getElementById('periodo-fim').addEventListener('change', ajustarPeriodo);
    document.getElementById('ramo-ranking').addEventListener('change', (evento) => {
      estado.ramoRanking = evento.target.value;
      renderRanking();
    });

    const faixaTop = document.getElementById('top-ramos');
    faixaTop.addEventListener('input', (evento) => {
      estado.topRamos = Number(evento.target.value);
      document.getElementById('top-ramos-saida').textContent = estado.topRamos;
    });
    faixaTop.addEventListener('change', renderRamos);

    const faixaRank = document.getElementById('top-ranking');
    faixaRank.addEventListener('input', (evento) => {
      estado.topRanking = Number(evento.target.value);
      document.getElementById('top-ranking-saida').textContent = estado.topRanking;
    });
    faixaRank.addEventListener('change', renderRanking);

    document.getElementById('escopo-ranking').addEventListener('click', (evento) => {
      const botao = evento.target.closest('.segmento');
      if (!botao) return;
      estado.escopoRanking = botao.dataset.escopo;
      document.querySelectorAll('#escopo-ranking .segmento').forEach((outro) => {
        outro.setAttribute('aria-checked', String(outro === botao));
      });
      renderRanking();
    });
  }

  // ------------------------------------------------------------ cabeçalho */
  function renderCabecalho() {
    const meta = D.meta;
    document.getElementById('topo-fonte').textContent =
      `Fonte: ${meta.fonte} · janela ${fmt.mes(meta.janela_ini)} a ${fmt.mes(meta.janela_fim)}`;

    const itens = [
      ['Janela', `${fmt.mes(meta.janela_ini)} – ${fmt.mes(meta.janela_fim)}`],
      ['Competências', fmt.inteiro(meta.competencias.length)],
      ['Empresas', fmt.inteiro(meta.empresas)],
      ['Ramos', fmt.inteiro(meta.ramos)],
      ['Atualizado em', meta.gerado_em || '–']
    ];
    document.getElementById('topo-numeros').innerHTML = itens
      .map(([rotulo, valor]) => `<div><dt>${rotulo}</dt><dd>${valor}</dd></div>`).join('');

    document.getElementById('rodape-geracao').textContent =
      `Dados de ${meta.gerado_em || '–'} · ${fmt.inteiro(meta.empresas)} empresas · ${fmt.inteiro(meta.ramos)} ramos · ${fmt.inteiro(meta.competencias.length)} competências.`;
  }

  // ------------------------------------------------------------------ init */
  async function iniciar() {
    try {
      const [meta, dimEmpresa, dimRamo, ramoMes, empresaMes, empresaRamo] = await Promise.all([
        lerJson('meta.json'), lerJson('dim_empresa.json'), lerJson('dim_ramo.json'),
        lerJson('fato_ramo_mes.json'), lerJson('fato_empresa_mes.json'), lerJson('fato_empresa_ramo.json')
      ]);

      D = {
        meta,
        dimEmpresa: emObjetos(dimEmpresa),
        dimRamo: emObjetos(dimRamo),
        ramoMes: emObjetos(ramoMes),
        empresaMes: emObjetos(empresaMes),
        empresaRamo: emObjetos(empresaRamo),
        empresas: new Map(),
        ramos: new Map()
      };
      D.dimEmpresa.forEach((e) => D.empresas.set(e.codigo_empresa, e.nome_empresa));
      D.dimRamo.forEach((r) => D.ramos.set(r.codigo_ramo, r.nome_ramo));
      D.competencias = (meta.competencias && meta.competencias.length
        ? meta.competencias.map(String)
        : competenciasDe(D.ramoMes)).slice().sort();

      renderCabecalho();
      preencherPeriodo();
      renderListaEmpresas();
      renderChips();
      ligarFiltros();
      trocarAba('ramos');
    } catch (erro) {
      document.getElementById('lista-empresas').innerHTML =
        `<p class="caixa-empresas__vazio">Falha ao carregar os dados: ${erro.message}. Sirva a pasta por HTTP (GitHub Pages ou <code>python -m http.server</code>).</p>`;
      const aviso = document.getElementById('aviso-filtro');
      aviso.textContent = 'Não foi possível carregar dados/*.json. Abrir o arquivo direto do disco (file://) bloqueia as requisições.';
      aviso.hidden = false;
    }
  }

  iniciar();
})();
