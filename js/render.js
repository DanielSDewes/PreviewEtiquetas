/* Renderização da etiqueta em <canvas> + detecção de elementos que
   ultrapassam as dimensões físicas informadas pelo usuário.

   Coordenadas em "dots" (pontos da impressora). 1 dot = 1/dpi polegada.
   dpmm = dpi / 25.4  ->  dots por milímetro. */

(function (global) {

  var measureCanvas = document.createElement('canvas');
  var mctx = measureCanvas.getContext('2d');

  // Largura calibrada contra a fonte 0 da Zebra usando o renderizador de
  // referência (Labelary): o avanço médio por caractere da fonte escalável 0
  // ≈ 0,5 × largura (w) do ^A. O Arial do navegador é ~20-30% mais largo, o que
  // fazia o texto "vazar" e colidir (ex.: nome da empresa cobrindo o telefone).
  var ZEBRA0_ADVANCE = 0.5;
  function measureText(text, h, w) {
    var t = text || '';
    var cw = (w || h) || 1;
    var width = t.length * ZEBRA0_ADVANCE * cw;
    mctx.font = h + 'px Arial, Helvetica, sans-serif';
    var m = mctx.measureText(t);
    var arial = m.width || width;
    var ascent = m.actualBoundingBoxAscent || h * 0.78;
    var descent = m.actualBoundingBoxDescent || h * 0.22;
    // fator para desenhar o texto comprimido de modo a coincidir com a largura real
    var drawScaleX = arial > 0 ? width / arial : 1;
    return { width: width, ascent: ascent, descent: descent, drawScaleX: drawScaleX };
  }

  // Estimativa do nº de módulos de um QR conforme o tamanho dos dados.
  function estimateQrModules(data) {
    var n = (data || '').replace(/^[HQML]?[AMN]?,?/i, '').length; // remove prefixo de ECC/modo
    if (n <= 16) return 21;
    if (n <= 30) return 25;
    if (n <= 46) return 29;
    if (n <= 66) return 33;
    if (n <= 90) return 37;
    return 41;
  }

  function estimateBarcodeWidth(el) {
    var mw = (el.barcode && el.barcode.moduleW) || 2;
    var len = (el.data || '').length || 1;
    // Aproximação para Code128/39: ~11 módulos por caractere + zonas/quiet/start/stop.
    return Math.round((len * 11 + 55) * mw);
  }

  // Calcula a caixa delimitadora (bbox) de cada elemento, em dots.
  function computeGeometry(el) {
    if (el.kind === 'box') {
      var b = el.box;
      var bw = b.w <= 0 ? b.t : b.w;
      var bh = b.h <= 0 ? b.t : b.h;
      el.bbox = { x0: el.x, y0: el.y, x1: el.x + Math.max(bw, b.t), y1: el.y + Math.max(bh, b.t) };
      el.estimated = false;
      return;
    }
    if (el.kind === 'qr') {
      var mag = el.qr.mag || 3;
      var modules = estimateQrModules(el.data);
      var size = modules * mag;
      el.size = size;
      if (el.anchor === 'FT') {
        // No ^BQ, o ^FT referencia ~3 módulos ABAIXO da base do símbolo
        // (zona de silêncio) — calibrado contra o Labelary e a impressão real.
        var bottom = el.y - 3 * mag;
        el.bbox = { x0: el.x, y0: bottom - size, x1: el.x + size, y1: bottom };
      } else {                  // FO = canto superior-esquerdo
        el.bbox = { x0: el.x, y0: el.y, x1: el.x + size, y1: el.y + size };
      }
      el.estimated = true;
      return;
    }
    if (el.kind === 'barcode') {
      var width = estimateBarcodeWidth(el);
      var height = el.barcode.height || 80;
      el.bw = width; el.bh = height;
      if (el.anchor === 'FT') {
        el.bbox = { x0: el.x, y0: el.y - height, x1: el.x + width, y1: el.y };
      } else {
        el.bbox = { x0: el.x, y0: el.y, x1: el.x + width, y1: el.y + height };
      }
      el.estimated = true;
      return;
    }
    // Texto
    var m = measureText(el.data, el.font.h, el.font.w);
    el.measured = m;
    if (el.anchor === 'FT') { // y = linha de base
      el.bbox = { x0: el.x, y0: el.y - m.ascent, x1: el.x + m.width, y1: el.y + m.descent };
    } else {                  // FO = topo do bloco de texto
      el.bbox = { x0: el.x, y0: el.y, x1: el.x + m.width, y1: el.y + m.ascent + m.descent };
    }
    el.estimated = false;
  }

  // Verifica overflow contra a etiqueta física (0,0)-(W,H), em dots.
  function checkOverflow(el, W, H) {
    var bb = el.bbox, edges = [], tol = 0.5;
    if (bb.x1 > W + tol) edges.push({ edge: 'direita', amount: bb.x1 - W });
    if (bb.y1 > H + tol) edges.push({ edge: 'inferior', amount: bb.y1 - H });
    if (bb.x0 < -tol)    edges.push({ edge: 'esquerda', amount: -bb.x0 });
    if (bb.y0 < -tol)    edges.push({ edge: 'superior', amount: -bb.y0 });
    el.overflow = edges.length > 0;
    el.edges = edges;
    return edges;
  }

  /* ---- Desenho --------------------------------------------------------- */
  function render(canvas, model, opts) {
    var W = opts.widthDots, H = opts.heightDots;
    var dpmm = opts.dpmm;
    var elements = model.elements;
    var highlight = opts.highlight; // índice do elemento a destacar (ou -1)

    elements.forEach(computeGeometry);
    var issues = [];
    elements.forEach(function (el, i) {
      var edges = checkOverflow(el, W, H);
      if (edges.length) issues.push({ index: i, el: el, edges: edges });
    });

    // Mundo a desenhar: união da etiqueta com todos os elementos + margem.
    var minX = 0, minY = 0, maxX = W, maxY = H;
    elements.forEach(function (el) {
      minX = Math.min(minX, el.bbox.x0); minY = Math.min(minY, el.bbox.y0);
      maxX = Math.max(maxX, el.bbox.x1); maxY = Math.max(maxY, el.bbox.y1);
    });
    var margin = Math.max(16, W * 0.04);
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    var worldW = maxX - minX, worldH = maxY - minY;

    // Escala para caber na largura disponível (CSS px).
    var cssW = Math.min(opts.maxWidthPx || 820, Math.max(360, (canvas.parentElement.clientWidth || 820) - 4));
    var scale = cssW / worldW;
    var cssH = worldH * scale;
    var dpr = global.devicePixelRatio || 1;

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Transformação dots -> px (com origem do mundo)
    function tx(x) { return (x - minX) * scale; }
    function ty(y) { return (y - minY) * scale; }
    function ts(v) { return v * scale; }

    // Fundo (área fora da etiqueta) levemente hachurado
    ctx.fillStyle = '#eceef2';
    ctx.fillRect(0, 0, cssW, cssH);

    // Etiqueta física
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx(0), ty(0), ts(W), ts(H));

    // Grade a cada 5 mm
    var step = 5 * dpmm;
    ctx.strokeStyle = '#eef1f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = step; gx < W; gx += step) { ctx.moveTo(tx(gx), ty(0)); ctx.lineTo(tx(gx), ty(H)); }
    for (var gy = step; gy < H; gy += step) { ctx.moveTo(tx(0), ty(gy)); ctx.lineTo(tx(W), ty(gy)); }
    ctx.stroke();

    // Borda da etiqueta
    ctx.strokeStyle = '#1f6feb';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx(0), ty(0), ts(W), ts(H));

    // Elementos
    elements.forEach(function (el, i) {
      var isOver = el.overflow;
      var isSel = (i === highlight);
      var color = isOver ? '#d1242f' : '#11161c';
      drawElement(ctx, el, { tx: tx, ty: ty, ts: ts, scale: scale, color: color });

      if (isOver || isSel) {
        ctx.save();
        ctx.setLineDash(isOver ? [6, 4] : []);
        ctx.strokeStyle = isOver ? '#d1242f' : '#1f6feb';
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.strokeRect(tx(el.bbox.x0) - 2, ty(el.bbox.y0) - 2,
                       ts(el.bbox.x1 - el.bbox.x0) + 4, ts(el.bbox.y1 - el.bbox.y0) + 4);
        ctx.restore();
      }
    });

    return { issues: issues, cssW: cssW, cssH: cssH };
  }

  function drawElement(ctx, el, t) {
    ctx.save();
    if (el.kind === 'box') {
      ctx.fillStyle = t.color;
      var b = el.box, th = Math.max(1, t.ts(b.t));
      if (b.w <= 0 || b.h <= 0) {
        // linha
        ctx.fillRect(t.tx(el.x), t.ty(el.y),
          t.ts(b.w <= 0 ? b.t : b.w), t.ts(b.h <= 0 ? b.t : b.h));
      } else {
        ctx.lineWidth = th;
        ctx.strokeStyle = t.color;
        ctx.strokeRect(t.tx(el.x) + th / 2, t.ty(el.y) + th / 2,
                       t.ts(b.w) - th, t.ts(b.h) - th);
      }
    } else if (el.kind === 'qr') {
      drawQr(ctx, el, t);
    } else if (el.kind === 'barcode') {
      drawBarcode(ctx, el, t);
    } else {
      // texto
      var px = el.font.h * t.scale;
      ctx.fillStyle = t.color;
      ctx.font = px + 'px Arial, Helvetica, sans-serif';
      ctx.textBaseline = 'alphabetic';
      var baseX = t.tx(el.x);
      var baseY = el.anchor === 'FT' ? t.ty(el.y) : t.ty(el.y) + (el.measured.ascent * t.scale);
      var sx = el.measured.drawScaleX || 1;
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.scale(sx, 1);
      ctx.fillText(el.data, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawQr(ctx, el, t) {
    var x = t.tx(el.bbox.x0), y = t.ty(el.bbox.y0), s = t.ts(el.size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, s, s);
    // padrões localizadores (cantos)
    var f = s * 0.28;
    ctx.fillStyle = t.color;
    [[0, 0], [s - f, 0], [0, s - f]].forEach(function (c) {
      ctx.fillRect(x + c[0], y + c[1], f, f);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + c[0] + f * 0.18, y + c[1] + f * 0.18, f * 0.64, f * 0.64);
      ctx.fillStyle = t.color;
      ctx.fillRect(x + c[0] + f * 0.36, y + c[1] + f * 0.36, f * 0.28, f * 0.28);
    });
    // textura central simples
    var m = el.size > 0 ? Math.max(8, Math.round(el.size / (el.qr.mag || 3))) : 21;
    var cell = s / m;
    ctx.fillStyle = t.color;
    for (var r = 3; r < m - 3; r++)
      for (var c2 = 3; c2 < m - 3; c2++)
        if (((r * 7 + c2 * 13) % 3) === 0)
          ctx.fillRect(x + c2 * cell, y + r * cell, cell, cell);
    label(ctx, el, t, 'QR');
  }

  function drawBarcode(ctx, el, t) {
    var x = t.tx(el.bbox.x0), y = t.ty(el.bbox.y0), w = t.ts(el.bw), h = t.ts(el.bh);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = t.color;
    var bx = x, seed = (el.data || 'x').length + 3;
    while (bx < x + w - 1) {
      var bw = ((Math.floor(bx + seed) % 3) + 1) * Math.max(1, t.ts(el.barcode.moduleW));
      ctx.fillRect(bx, y, Math.min(bw, x + w - bx), h);
      bx += bw + Math.max(1, t.ts(el.barcode.moduleW)) * (((Math.floor(bx) % 2) + 1));
    }
    label(ctx, el, t, el.barcode.type);
  }

  function label(ctx, el, t, txt) {
    ctx.fillStyle = el.overflow ? '#d1242f' : '#6b7280';
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText(txt, t.tx(el.bbox.x0), t.ty(el.bbox.y0) - 3);
  }

  global.Render = { render: render, computeGeometry: computeGeometry };
})(window);

// forcing commit