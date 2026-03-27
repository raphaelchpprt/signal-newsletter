/**
 * Corrige les fermetures incorrectes du modèle (ex. ==text** → ==text==).
 * Le markup attendu est **gras** et ==surligné== — délimiteurs toujours appariés.
 * Machine à états pour ne pas confondre le == fermant de ==ok== avec une ouverture.
 */
export function normalizeMarkupDelimiters(text) {
  if (!text || typeof text !== 'string') return text;
  let out = '';
  let i = 0;
  let inHighlight = false;
  let inBold = false;

  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];

    if (c === '=' && c2 === '=') {
      if (inBold) {
        // **…== : fermeture erronée du gras
        inBold = false;
        out += '**';
      } else {
        inHighlight = !inHighlight;
        out += '==';
      }
      i += 2;
      continue;
    }

    if (c === '*' && c2 === '*') {
      if (inHighlight) {
        // ==…** : fermeture erronée du surligné
        inHighlight = false;
        out += '==';
      } else {
        inBold = !inBold;
        out += '**';
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}
