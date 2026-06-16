/* Wiring da interface: lê os controles, processa o PRN e mostra
   pré-visualização, lista de erros e o código-fonte com as linhas problemáticas. */

(function () {
  var $ = function (id) { return document.getElementById(id); };

  // DPI padrão por impressora (a maioria dos modelos térmicos é 203 dpi).
  var PRINTER_DPI = { zebra: 203, argox: 203, elgin: 203 };

  var state = { model: null, opts: null, segments: null };

  function mmFromInput() {
    var unit = $('unit').value;
    var f = unit === 'cm' ? 10 : 1;
    var w = parseFloat(($('width').value || '0').replace(',', '.')) * f;
    var h = parseFloat(($('height').value || '0').replace(',', '.')) * f;
    return { wmm: w, hmm: h, unit: unit };
  }

  function fmtMm(dots, dpmm) { return (dots / dpmm).toFixed(1).replace('.', ',') + ' mm'; }

  function preview() {
    var printer = $('printer').value;
    var dpi = parseInt($('dpi').value, 10) || PRINTER_DPI[printer] || 203;
    var dim = mmFromInput();
    var dpmm = dpi / 25.4;
    var raw = $('prn').value;

    if (!raw.trim()) { setSummary('warn', 'Cole o conteúdo do PRN para visualizar.'); return; }
    if (!(dim.wmm > 0 && dim.hmm > 0)) { setSummary('warn', 'Informe largura e altura válidas.'); return; }

    var segments = PRN.unwrap(raw);
    if (!segments.length) { setSummary('warn', 'Nenhum comando de etiqueta encontrado no texto.'); return; }

    var model = ZPL.parse(segments);
    state.segments = segments;
    state.model = model;

    var opts = {
      widthDots: Math.round(dim.wmm * dpmm),
      heightDots: Math.round(dim.hmm * dpmm),
      dpmm: dpmm, dpi: dpi, printer: printer, highlight: -1
    };
    state.opts = opts;

    if (model.language !== 'zpl') {
      setSummary('warn', 'Linguagem detectada: ' + model.language.toUpperCase() +
        '. No momento a renderização suporta ZPL (Zebra e impressoras em modo ZPL).');
    }

    var result = Render.render($('canvas'), model, opts);
    renderMeta(model, opts, dim);
    renderIssues(result.issues, opts);
    renderSource(segments, result.issues);

    if (result.issues.length === 0) {
      setSummary('ok', 'Etiqueta dentro das dimensões (' +
        fmt(dim.wmm) + ' × ' + fmt(dim.hmm) + ' mm). Nenhum elemento ultrapassa os limites.');
    } else {
      var errors = result.issues.filter(function (x) { return !x.el.estimated; }).length;
      var warns = result.issues.length - errors;
      setSummary(errors ? 'err' : 'warn',
        result.issues.length + ' elemento(s) ultrapassam a etiqueta' +
        (errors ? ' — ' + errors + ' confirmado(s)' : '') +
        (warns ? (errors ? ', ' : ' — ') + warns + ' estimado(s)' : '') + '.');
    }
  }

  function fmt(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }

  function renderMeta(model, opts, dim) {
    var c = model.config, dpmm = opts.dpmm;
    var rows = [];
    rows.push(['Impressora / DPI', opts.printer + ' · ' + opts.dpi + ' dpi']);
    rows.push(['Etiqueta informada', fmt(dim.wmm) + ' × ' + fmt(dim.hmm) + ' mm  (' +
      opts.widthDots + ' × ' + opts.heightDots + ' dots)']);
    if (c.pw != null || c.ll != null) {
      var pwmm = c.pw != null ? (c.pw / dpmm).toFixed(1).replace('.', ',') + ' mm' : '—';
      var llmm = c.ll != null ? (c.ll / dpmm).toFixed(1).replace('.', ',') + ' mm' : '—';
      rows.push(['Definido no PRN (^PW/^LL)',
        (c.pw != null ? c.pw : '—') + ' × ' + (c.ll != null ? c.ll : '—') + ' dots  (' +
        pwmm + ' × ' + llmm + ')']);
    }
    rows.push(['Elementos desenháveis', String(model.elements.length)]);

    var html = '<table class="meta">';
    rows.forEach(function (r) { html += '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; });
    html += '</table>';

    // Aviso se ^PW/^LL diverge muito do informado
    var notes = [];
    if (c.pw != null && Math.abs(c.pw - opts.widthDots) > opts.dpmm * 2)
      notes.push('A largura do PRN (^PW' + c.pw + ') difere da informada em mais de 2 mm.');
    if (c.ll != null && Math.abs(c.ll - opts.heightDots) > opts.dpmm * 2)
      notes.push('A altura do PRN (^LL' + c.ll + ') difere da informada em mais de 2 mm.');
    if (notes.length) html += '<div class="note">⚠ ' + notes.join('<br>⚠ ') + '</div>';

    $('meta').innerHTML = html;
  }

  function renderIssues(issues, opts) {
    var el = $('issues');
    if (!issues.length) {
      el.innerHTML = '<div class="empty">Nenhum elemento ultrapassa os limites da etiqueta. ✔</div>';
      return;
    }
    var dpmm = opts.dpmm;
    var html = '';
    issues.forEach(function (it, n) {
      var e = it.el;
      var desc = it.edges.map(function (ed) {
        return 'borda ' + ed.edge + ' em ' + Math.round(ed.amount) + ' dots (' +
          (ed.amount / dpmm).toFixed(1).replace('.', ',') + ' mm)';
      }).join('; ');
      var tag = e.estimated
        ? '<span class="badge warn">estimado</span>'
        : '<span class="badge err">confirmado</span>';
      var kind = e.kind === 'box' ? 'Linha/Caixa' : e.kind === 'qr' ? 'QR Code'
        : e.kind === 'barcode' ? ('Código ' + e.barcode.type) : 'Texto';
      var content = e.data ? ('“' + escapeHtml(e.data) + '”') : '';
      html += '<div class="issue ' + (e.estimated ? 'w' : 'e') + '" data-idx="' + it.index + '">' +
        '<div class="issue-h"><b>Linha ' + e.srcLine + '</b> · ' + kind + ' ' + tag + '</div>' +
        '<div class="issue-b">Ultrapassa ' + desc + '.</div>' +
        (content ? '<div class="issue-c">' + content + '</div>' : '') +
        '<code class="issue-cmd">' + escapeHtml(e.cmd) + '</code>' +
        '</div>';
    });
    el.innerHTML = html;

    Array.prototype.forEach.call(el.querySelectorAll('.issue'), function (node) {
      node.addEventListener('mouseenter', function () { highlight(parseInt(node.dataset.idx, 10)); });
      node.addEventListener('mouseleave', function () { highlight(-1); });
      node.addEventListener('click', function () {
        var ln = state.model.elements[parseInt(node.dataset.idx, 10)].srcLine;
        var line = document.querySelector('.src-line[data-line="' + ln + '"]');
        if (line) line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function highlight(idx) {
    if (!state.model) return;
    state.opts.highlight = idx;
    Render.render($('canvas'), state.model, state.opts);
  }

  function renderSource(segments, issues) {
    var badLines = {};
    issues.forEach(function (it) { badLines[it.el.srcLine] = it.el.estimated ? 'w' : 'e'; });
    var html = '';
    segments.forEach(function (seg) {
      var cls = badLines[seg.srcLine] ? ('bad ' + badLines[seg.srcLine]) : '';
      html += '<div class="src-line ' + cls + '" data-line="' + seg.srcLine + '">' +
        '<span class="ln">' + seg.srcLine + '</span>' +
        '<span class="code">' + escapeHtml(seg.zpl) + '</span></div>';
    });
    $('source').innerHTML = html;
  }

  function setSummary(kind, msg) {
    var el = $('summary');
    el.className = 'summary ' + kind;
    el.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // --- eventos ---
  window.addEventListener('DOMContentLoaded', function () {
    $('printer').addEventListener('change', function () {
      $('dpi').value = String(PRINTER_DPI[$('printer').value] || 203);
    });
    $('btn-preview').addEventListener('click', preview);
    $('btn-clear').addEventListener('click', function () {
      $('prn').value = ''; $('source').innerHTML = ''; $('issues').innerHTML = '';
      $('meta').innerHTML = ''; setSummary('', 'Aguardando o PRN…');
      var cv = $('canvas'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    });
    $('btn-example').addEventListener('click', function () {
      $('printer').value = 'zebra'; $('dpi').value = '203';
      $('width').value = '100'; $('height').value = '40'; $('unit').value = 'mm';
      $('prn').value = EXAMPLE_PRN; preview();
    });
    $('file').addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { $('prn').value = reader.result; preview(); };
      reader.readAsText(f, 'utf-8');
    });
    window.addEventListener('resize', function () {
      if (state.model) Render.render($('canvas'), state.model, state.opts);
    });
    setSummary('', 'Aguardando o PRN…');
  });

  // Exemplo embutido (mesmo PRN da Zebra ZD230 100×40 mm).
  var EXAMPLE_PRN = [
    '@echo ^^XA~TA000~JSN^^LT10^^MNW^^MTT^^PON^^PMN^^LH0,0^^JMA^^PR10,10~SD15^^JUS^^LRN^^CI0^^XZ> zebraZD230_termica_100x40.prn',
    '@echo ^^XA>> zebraZD230_termica_100x40.prn',
    '@echo ^^MMT>> zebraZD230_termica_100x40.prn',
    '@echo ^^PW799>> zebraZD230_termica_100x40.prn',
    '@echo ^^LL0320>> zebraZD230_termica_100x40.prn',
    '@echo ^^LS0>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT568,328^^BQN,2,10>> zebraZD230_termica_100x40.prn',
    '@echo ^^FH\\^^FDLA,1053-1215^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FO15,88^^GB536,0,3^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,68^^A0N,51,50^^FH\\^^FDRAIZ AGRO COMERCIO^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT482,41^^A0N,25,24^^FH\\^^FD44 99177-7984^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT482,74^^A0N,25,24^^FH\\^^FD^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,116^^A0N,20,19^^FH\\^^FP/N:^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,169^^A0N,51,50^^FH\\^^FD1053-1215^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,190^^A0N,20,19^^FH\\^^FDLocacao: ^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT100,195^^A0N,28,23^^FH\\^^FD102-GAV-7-^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,207^^A0N,20,19^^FH\\^^FDDescri\\87\\C6o:^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,239^^A0N,28,28^^FH\\^^FDGAXETA FIBRA AMIANTO 5/16X45/61^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^FT15,273^^A0N,28,28^^FH\\^^FD^^FS>> zebraZD230_termica_100x40.prn',
    '@echo ^^PQ1,0,1,Y^^XZ>> zebraZD230_termica_100x40.prn',
    'type zebraZD230_termica_100x40.prn > \\\\192.168.0.119\\zebra',
    'del zebraZD230_termica_100x40.prn',
    'del %0'
  ].join('\n');
})();
