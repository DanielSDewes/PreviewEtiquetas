/* Desempacota um arquivo .prn que pode vir embrulhado em um .bat/.cmd.

   No exemplo da Zebra cada comando ZPL está dentro de uma linha como:
       @echo ^^XA>> zebraZD230_termica_100x40.prn
   Em batch, "^" é caractere de escape, então "^^" representa um "^" literal.
   Também há linhas de CMD que NÃO fazem parte da etiqueta (type, del, @echo off...)
   e que devem ser ignoradas.

   Resultado: lista de segmentos { srcLine, zpl } preservando o número da linha
   ORIGINAL do arquivo, para conseguirmos apontar onde está o erro.

   Obs.: este arquivo se chama "prn-parser.js" (e não "prn.js") porque "PRN" é um
   nome de dispositivo reservado no Windows e quebra ferramentas como o Git. */

(function (global) {
  // Comandos de CMD/batch que não fazem parte da etiqueta.
  var SKIP_RE = /^\s*@?(echo\s+off|type|del|erase|rem|set|pause|cls|goto|if|for|copy|xcopy|ren|rename|move|md|mkdir|rd|cd|exit|ping|timeout|color|title|start|call|setlocal|endlocal|pushd|popd)\b/i;

  function unwrap(text) {
    var rawLines = String(text).split(/\r\n|\r|\n/);
    var segments = [];

    rawLines.forEach(function (line, idx) {
      var srcLine = idx + 1;
      var s = line;

      // Linha do tipo "@echo CONTEUDO>> arquivo.prn"
      var m = s.match(/^\s*@?echo[.\s]+(.*)$/i);
      if (m) {
        var content = m[1];
        // remove o redirecionamento final ">> arquivo" ou "> arquivo"
        content = content.replace(/\s*>>?\s*\S+\s*$/, '');
        if (/^off\s*$/i.test(content)) return;        // "@echo off"
        content = content.replace(/\^\^/g, '^');       // desescapa carets do batch
        content = content.trim();
        if (content) segments.push({ srcLine: srcLine, zpl: content });
        return;
      }

      if (SKIP_RE.test(s)) return;

      // Linha de ZPL "cru" (colado direto, sem o embrulho de batch).
      if (/[\^~]/.test(s)) {
        var z = s.trim();
        if (z) segments.push({ srcLine: srcLine, zpl: z });
      }
    });

    return segments;
  }

  global.PRN = { unwrap: unwrap };
})(window);
