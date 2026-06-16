/* Parser ZPL II.
   Converte os segmentos do PRN (ver prn.js) em:
     - config: { pw, ll, dpiHint, ... } lidos do próprio PRN
     - elements: lista de campos desenháveis (texto, caixa, QR, código de barras)
       cada um com a linha de origem (srcLine) para apontar erros.

   Cobre os comandos mais comuns. Comandos desconhecidos são ignorados com
   segurança (e listados em "unknown" para diagnóstico). */

(function (global) {

  function toInt(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (def === undefined ? 0 : def) : n;
  }

  /* ---- 1) Tokenização -------------------------------------------------- */
  // Cada token: { prefix:'^'|'~', code:'FT'|'A'|..., font:'0', params:'...', srcLine }
  function tokenize(segments) {
    var tokens = [];
    segments.forEach(function (seg) {
      var str = seg.zpl;
      var i = 0, n = str.length;
      while (i < n) {
        var ch = str[i];
        if (ch === '^' || ch === '~') {
          // corpo do comando = até o próximo ^ ou ~
          var j = i + 1;
          while (j < n && str[j] !== '^' && str[j] !== '~') j++;
          var body = str.slice(i + 1, j);
          if (body.length === 0) { i = j; continue; }

          if (body[0] === 'A') {
            // Comando de fonte: ^A<designador><orientação>,<alt>,<larg>
            tokens.push({
              prefix: ch, code: 'A', font: body[1] || '0',
              params: body.slice(2), srcLine: seg.srcLine
            });
          } else {
            tokens.push({
              prefix: ch, code: body.slice(0, 2).toUpperCase(),
              params: body.slice(2), srcLine: seg.srcLine
            });
          }
          i = j;
        } else {
          i++; // ignora ruído fora de comandos
        }
      }
    });
    return tokens;
  }

  /* ---- 2) Construção dos elementos ------------------------------------- */
  function build(tokens) {
    var config = { pw: null, ll: null, lh: { x: 0, y: 0 }, ls: 0, ci: 0,
                   by: { w: 2, r: 3, h: 10 }, cf: { f: '0', h: 30, w: 30 } };
    var elements = [];
    var unknown = [];
    var cur = null; // campo em construção

    function startField(tok, anchor) {
      var p = tok.params.split(',');
      cur = {
        anchor: anchor,
        x: config.lh.x + config.ls + toInt(p[0]),
        y: config.lh.y + toInt(p[1]),
        srcLine: tok.srcLine,
        font: { f: config.cf.f, h: config.cf.h, w: config.cf.w, o: 'N' },
        hex: false, hexInd: '\\',
        kind: null, data: '', cmd: tok.prefix + tok.code + tok.params
      };
    }

    function finishField() {
      if (!cur) return;
      var hasContent = cur.kind === 'box' || cur.kind === 'qr' ||
                       cur.kind === 'barcode' || (cur.data && cur.data.length);
      if (hasContent) elements.push(cur);
      cur = null;
    }

    tokens.forEach(function (tok) {
      var code = tok.code;
      var p = tok.params.split(',');

      switch (code) {
        case 'XA': break;                       // início do formato
        case 'XZ': finishField(); break;        // fim do formato
        case 'PW': config.pw = toInt(tok.params); break;
        case 'LL': config.ll = toInt(tok.params); break;
        case 'LH': config.lh = { x: toInt(p[0]), y: toInt(p[1]) }; break;
        case 'LS': config.ls = toInt(tok.params); break;
        case 'CI': config.ci = toInt(tok.params); break;
        case 'BY':
          config.by = { w: toInt(p[0], 2), r: parseFloat(p[1]) || 3, h: toInt(p[2], 10) };
          break;
        case 'CF':
          config.cf = { f: p[0] || '0', h: toInt(p[1], 30), w: toInt(p[2], toInt(p[1], 30)) };
          break;

        case 'FO': startField(tok, 'FO'); break;
        case 'FT': startField(tok, 'FT'); break;

        case 'A':
          if (cur) {
            var ap = tok.params.split(',');
            var oriented = /^[NRIB]$/i.test(ap[0]);
            var h = toInt(oriented ? ap[1] : ap[0], config.cf.h);
            var w = toInt(oriented ? ap[2] : ap[1], h);
            cur.font = { f: tok.font, o: (oriented ? ap[0].toUpperCase() : 'N'), h: h, w: w || h };
          }
          break;

        case 'GB':
          if (cur) {
            cur.kind = 'box';
            cur.box = { w: toInt(p[0]), h: toInt(p[1]), t: toInt(p[2], 1) };
          }
          break;

        case 'BQ': // QR Code
          if (cur) {
            cur.kind = 'qr';
            cur.qr = { model: toInt(p[1], 2), mag: toInt(p[2], 3) };
          }
          break;

        case 'BC': // Code 128
        case 'B3': // Code 39
        case 'BE': // EAN-13
        case 'B8': // EAN-8
        case 'B2': // Interleaved 2of5
        case 'BU': // UPC-A
        case 'B7': // PDF417 (tratado como 2D aproximado)
          if (cur) {
            cur.kind = 'barcode';
            var bnames = { BC: 'Code128', B3: 'Code39', BE: 'EAN-13', B8: 'EAN-8',
                           B2: 'I2of5', BU: 'UPC-A', B7: 'PDF417' };
            // ^B?o,h,...  -> altura costuma ser o 2º parâmetro
            var oriented2 = /^[NRIB]$/i.test(p[0]);
            cur.barcode = {
              type: bnames[code] || code,
              height: toInt(oriented2 ? p[1] : p[0], config.by.h * 5),
              moduleW: config.by.w
            };
          }
          break;

        case 'FH': // Field Hexadecimal
          if (cur) { cur.hex = true; if (tok.params) cur.hexInd = tok.params.charAt(0); }
          break;

        case 'FD': case 'FV': case 'FN':
          if (cur) cur.data = decodeData(tok.params, cur);
          break;

        case 'FP': // alguns geradores usam ^FP indevidamente para texto
          if (cur && !/^[HVR]?,?\d*$/i.test(tok.params)) cur.data = decodeData(tok.params, cur);
          break;

        case 'FS': finishField(); break;

        // comandos de configuração sem efeito visual — ignorados de propósito
        case 'MM': case 'MN': case 'MT': case 'PO': case 'PM': case 'JM':
        case 'PR': case 'SD': case 'JU': case 'LR': case 'TA': case 'JS':
        case 'LT': case 'PQ': case 'FR': case 'FW': case 'CC': case 'CT':
          break;

        default:
          unknown.push({ code: tok.prefix + code, srcLine: tok.srcLine });
      }
    });

    finishField();
    return { config: config, elements: elements, unknown: unknown };
  }

  function decodeData(raw, field) {
    if (field && field.hex) return global.CP850.decodeFieldHex(raw, field.hexInd);
    return raw;
  }

  // Detecta a linguagem (por enquanto só ZPL é renderizado).
  function detectLanguage(segments) {
    var all = segments.map(function (s) { return s.zpl; }).join('\n');
    if (/\^XA/i.test(all) || /\^FD/i.test(all)) return 'zpl';
    if (/^\s*(N|A\d|B\d|Q\d|q\d)\b/m.test(all)) return 'epl';
    return 'unknown';
  }

  function parse(segments) {
    var language = detectLanguage(segments);
    var tokens = tokenize(segments);
    var built = build(tokens);
    built.language = language;
    built.tokens = tokens;
    return built;
  }

  global.ZPL = { parse: parse, tokenize: tokenize };
})(window);
