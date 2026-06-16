# Pré-visualização de Etiquetas PRN

Site para pré-visualizar etiquetas a partir do arquivo `.prn` (ou do `.bat`/`.cmd`
que o gera) e detectar quando algum elemento **ultrapassa as dimensões da etiqueta**,
apontando em qual linha do PRN está o problema.

## Como usar

1. Abra `index.html` no navegador (duplo clique já funciona).
   - Para evitar restrições de `file://`, você também pode servir a pasta:
     `python -m http.server 4173` e acessar `http://localhost:4173`.
2. Escolha a **impressora** e a **resolução (DPI)** — 203 dpi é o padrão da maioria
   das térmicas (ex.: Zebra ZD230). Use 300/600 dpi se for o caso do seu modelo.
3. Informe a **largura × altura** da etiqueta e a unidade (**mm** ou **cm**).
   Aceita vírgula decimal (ex.: `3,5`).
4. Cole o conteúdo do PRN/`.bat` ou clique em **Abrir arquivo…**.
   Os comandos de CMD (`@echo`, `type`, `del`, …) e o escape `^^` do batch são
   tratados automaticamente.
5. Clique em **Pré-visualizar**. Use **Exemplo** para carregar o caso da Zebra 100×40.

## O que o site mostra

- **Pré-visualização** da etiqueta em escala, com a borda física desenhada.
  Elementos que saem da área aparecem em **vermelho** (com caixa tracejada) e a
  área fora da etiqueta fica em cinza.
- **Problemas encontrados**: para cada elemento que vaza, mostra a **linha do PRN**,
  o tipo, por quantos *dots* e *mm* ultrapassa cada borda e o comando responsável.
  - `confirmado` — medição precisa (textos e caixas/linhas).
  - `estimado` — tamanho aproximado (QR Code e códigos de barras, cujo tamanho
    depende dos dados; a posição é exata, o tamanho é uma estimativa).
- **Código do PRN** com numeração; as linhas problemáticas ficam destacadas.
  Passe o mouse sobre um problema para realçá-lo no desenho; clique para rolar
  até a linha.
- Aviso quando o `^PW`/`^LL` definido no próprio PRN diverge das dimensões informadas.

## Linguagens suportadas

- **ZPL II** (Zebra, e impressoras Argox/Elgin operando em modo ZPL) — completo:
  `^FO/^FT`, fontes `^A`, `^GB`, `^BQ` (QR), códigos de barras `^BC/^B3/...`,
  `^FH` com decodificação **CP850** (acentos), `^PW`, `^LL`, `^LH`, `^LS`, `^CF`, `^BY`.

> **Argox (PPLA/PPLB)** e **Elgin** em sua linguagem nativa ainda **não** são
> interpretados. Para adicioná-los com fidelidade, basta um PRN de exemplo de cada
> — a arquitetura já é modular (veja abaixo).

## Estrutura

```
index.html         interface
css/styles.css     estilos
js/cp850.js        decodificação CP850 (acentos do ^FH)
js/prn.js          desempacota o .bat/.cmd -> comandos da etiqueta (+ nº da linha)
js/zpl.js          parser ZPL -> elementos desenháveis
js/render.js       geometria, detecção de overflow e desenho no <canvas>
js/app.js          interface (lê controles, monta resultado)
exemplos/          PRN de exemplo
```

Para suportar outra linguagem, crie um parser que produza a mesma estrutura de
`elements` (objetos com `anchor`, `x`, `y`, `kind`, `data`, `srcLine`, …) que o
`render.js` já sabe desenhar e medir.

## Observações de precisão

- Larguras de texto usam a fonte do navegador como aproximação da fonte 0 do ZPL —
  muito próximas, mas não idênticas ao firmware da impressora.
- QR/códigos de barras: a **posição** é exata; o **tamanho** é estimado a partir do
  volume de dados e da magnificação/`^BY`. Por isso são marcados como `estimado`.
