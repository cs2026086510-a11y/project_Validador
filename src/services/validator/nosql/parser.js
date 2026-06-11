const { Lexer, TokenTypes } = require('../lexer');

const MONGO_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$and', '$or', '$not', '$nor', '$exists', '$type', '$mod',
  '$regex', '$text', '$where', '$all', '$elemMatch', '$size',
  '$slice', '$set', '$unset', '$inc', '$push', '$pull', '$addToSet',
  '$pop', '$rename', '$currentDate', '$mul', '$min', '$max',
  '$sum', '$avg', '$first', '$last', '$match', '$group', '$sort',
  '$project', '$limit', '$skip', '$unwind', '$lookup', '$count',
  '$addFields', '$replaceRoot', '$out', '$merge', '$bucket',
  '$facet', '$geoNear', '$graphLookup', '$indexStats', '$listSessions',
  '$planCacheStats', '$redact', '$sample', '$sortByCount', '$unionWith',
  '$expr', '$jsonSchema', '$setOnInsert', '$bucketAuto', '$search', '$vectorSearch',
  // Additional common operators
  '$each', '$position', '$sort', '$natural',
  '$cond', '$ifNull', '$switch', '$dateToString', '$toString',
  '$toInt', '$toLong', '$toDouble', '$toObjectId', '$toDate',
  '$concat', '$substr', '$toLower', '$toUpper', '$trim',
  '$arrayElemAt', '$filter', '$map', '$reduce', '$concatArrays',
  '$isArray', '$reverseArray', '$zip',
  '$abs', '$ceil', '$floor', '$log', '$pow', '$sqrt', '$trunc',
  '$dayOfMonth', '$dayOfWeek', '$dayOfYear', '$hour', '$minute',
  '$second', '$millisecond', '$month', '$week', '$year',
  '$dateFromParts', '$dateToParts', '$dateFromString',
  '$literal', '$meta', '$objectToArray', '$arrayToObject',
  '$mergeObjects', '$setEquals', '$setIntersection', '$setUnion',
  '$setDifference', '$setIsSubset', '$anyElementTrue', '$allElementsTrue',
  '$replaceWith', '$replaceAll', '$regexFind', '$regexFindAll', '$regexMatch',
  '$accumulator', '$function', '$let', '$rand', '$sampleRate',
  '$densify', '$fill', '$setWindowFields', '$documents'
];

const MONGO_OPERATOR_SET = new Set(MONGO_OPERATORS);

// Operators that appear as KEYS in objects (left side of colon)
const MONGO_KEY_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$and', '$or', '$not', '$nor', '$exists', '$type', '$mod',
  '$regex', '$text', '$where', '$all', '$elemMatch', '$size',
  '$slice', '$set', '$unset', '$inc', '$push', '$pull', '$addToSet',
  '$pop', '$rename', '$currentDate', '$mul', '$min', '$max',
  '$match', '$group', '$sort', '$project', '$limit', '$skip',
  '$unwind', '$lookup', '$count', '$addFields', '$replaceRoot',
  '$out', '$merge', '$bucket', '$facet', '$geoNear', '$graphLookup',
  '$redact', '$sample', '$sortByCount', '$unionWith',
  '$expr', '$jsonSchema', '$setOnInsert', '$bucketAuto',
  '$search', '$vectorSearch', '$each', '$position',
  '$cond', '$ifNull', '$switch', '$dateToString', '$toString',
  '$concat', '$substr', '$toLower', '$toUpper', '$trim',
  '$arrayElemAt', '$filter', '$map', '$reduce', '$concatArrays',
  '$sum', '$avg', '$first', '$last',
  '$literal', '$meta', '$objectToArray', '$arrayToObject',
  '$mergeObjects', '$replaceWith', '$let',
  '$densify', '$fill', '$setWindowFields', '$documents',
  '$natural', '$indexStats', '$listSessions', '$planCacheStats'
]);

const MONGO_COMMANDS = [
  'find', 'findOne', 'insertOne', 'insertMany', 'updateOne',
  'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'aggregate',
  'countDocuments', 'estimatedDocumentCount', 'distinct', 'bulkWrite',
  'createIndex', 'dropIndex', 'dropIndexes', 'renameCollection', 'watch',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'sort', 'limit', 'skip', 'count', 'explain', 'toArray', 'pretty',
  'forEach', 'map', 'hasNext', 'next', 'drop', 'remove', 'save',
  'update', 'insert', 'getIndexes', 'stats', 'validate',
  'createCollection', 'renameCollection'
];

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function findSimilar(word, list) {
  for (let kw of list) {
    if (word === kw) continue;
    const dist = levenshtein(word, kw);
    if (dist <= 2 && word.length >= 3) {
      if (dist === 1 || (dist === 2 && word.length >= 4)) {
        return kw;
      }
    }
  }
  return null;
}

/**
 * Checks if a $-prefixed value is a field path reference vs an operator.
 * Field paths are values like "$categoria", "$monto" used in aggregation
 * to reference document fields. They appear as VALUES (right side of colon),
 * not as KEYS (left side of colon).
 *
 * Context tracking: We track whether a $-prefixed token appears in key or value position.
 */
function isFieldPathReference(val) {
  // Field paths: $fieldName, $$variable (system variables like $$ROOT, $$NOW)
  // They do NOT start with a known operator prefix pattern
  // Single $ + lowercase name without known operator = field path
  if (val.startsWith('$$')) return true; // System variables
  if (MONGO_OPERATOR_SET.has(val)) return false; // Known operator
  // If it looks like $someFieldName (not a known operator), it's a field reference
  return /^\$[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(val);
}

class MongoParser {
  constructor(query) {
    this.query = query.trim();
    const lexer = new Lexer(this.query, true);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.errors = [];
    this.suggestions = [];
  }

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    if (this.pos < this.tokens.length) {
      return this.tokens[this.pos++];
    }
    return this.tokens[this.tokens.length - 1];
  }

  match(expectedValue) {
    const token = this.peek();
    if (token.type === TokenTypes.EOF) return false;
    if (token.value === expectedValue) {
      this.advance();
      return true;
    }
    return false;
  }

  addError(message, line, column, operator = null, fragment = null, suggestion = null) {
    this.errors.push({ line, column, message, operator, fragment, suggestion });
  }

  parse() {
    if (this.tokens.length <= 1) {
      this.addError('La consulta está vacía.', 1, 1, null, null, 'Escribe una consulta válida.');
      return this.getResult();
    }

    if (this.query.startsWith('{') || this.query.startsWith('[')) {
      return this.parseJSON();
    }

    if (!this.match('db')) {
      const token = this.peek();
      this.addError(
        `Error de sintaxis.\nSe esperaba:\ndb\n\nSe encontró:\n${token.value || 'FIN DE CONSULTA'}`,
        token.line, token.column, null, token.value,
        'Inicia la consulta con "db."'
      );
      return this.getResult();
    }

    if (!this.match('.')) {
      const token = this.peek();
      this.addError(
        `Error de sintaxis.\nSe esperaba:\n.\n\nSe encontró:\n${token.value}`,
        token.line, token.column, null, token.value,
        'Utiliza el punto "." para acceder a la colección.'
      );
      return this.getResult();
    }

    const collectionToken = this.advance();
    if (collectionToken.type !== TokenTypes.IDENTIFIER && collectionToken.type !== TokenTypes.STRING) {
      this.addError(
        `Error de sintaxis. Nombre de colección no válido.`,
        collectionToken.line, collectionToken.column, null, collectionToken.value,
        'Escribe un nombre de colección válido.'
      );
      return this.getResult();
    }

    if (!this.match('.')) {
      const token = this.peek();
      this.addError(
        `Error de sintaxis.\nSe esperaba:\n.\n\nSe encontró:\n${token.value}`,
        token.line, token.column, null, token.value,
        'Falta el punto "." antes del comando.'
      );
      return this.getResult();
    }

    const commandToken = this.advance();
    if (!MONGO_COMMANDS.includes(commandToken.value)) {
      const sim = findSimilar(commandToken.value, MONGO_COMMANDS);
      if (sim) {
        this.addError(
          `Comando desconocido "${commandToken.value}".`,
          commandToken.line, commandToken.column, null, commandToken.value,
          `Quizás quiso escribir: ${sim}`
        );
      } else {
        this.addError(
          `Comando desconocido "${commandToken.value}".`,
          commandToken.line, commandToken.column, null, commandToken.value,
          `Soportados: ${MONGO_COMMANDS.slice(0, 10).join(', ')}...`
        );
      }
    }

    if (!this.match('(')) {
      const token = this.peek();
      this.addError(
        `Error de sintaxis.\nSe esperaba:\n(\n\nSe encontró:\n${token.value}`,
        token.line, token.column, null, token.value,
        'Falta el paréntesis de apertura "(".'
      );
      return this.getResult();
    }

    this.scanObjectAndCheckOperators(1);

    if (!this.match(')')) {
      if (this.peek().type !== TokenTypes.EOF) {
        this.advance();
      } else {
        const token = this.tokens[this.tokens.length - 2] || this.peek();
        this.addError(
          `Error de sintaxis. Falta paréntesis de cierre.`,
          token.line, token.column, null, null,
          'Agregue ) al final del comando.'
        );
      }
    }

    // Support chained methods: .sort(), .limit(), .skip(), .pretty(), etc.
    while (this.peek().type !== TokenTypes.EOF && this.peek().type === TokenTypes.DOT) {
      this.advance(); // consume '.'
      const chainToken = this.peek();
      if (chainToken.type === TokenTypes.IDENTIFIER) {
        const chainCmd = chainToken.value;
        this.advance();
        if (MONGO_COMMANDS.includes(chainCmd) || ['sort','limit','skip','pretty','toArray','count','explain','forEach','map','hasNext','next'].includes(chainCmd)) {
          if (this.match('(')) {
            this.scanObjectAndCheckOperators(1);
            if (!this.match(')')) {
              if (this.peek().type === TokenTypes.EOF) {
                this.addError('Falta paréntesis de cierre para método encadenado.',
                  chainToken.line, chainToken.column, null, chainCmd,
                  `Agregue ) al final de .${chainCmd}()`);
              }
            }
          }
        } else {
          const sim = findSimilar(chainCmd, MONGO_COMMANDS);
          if (sim) {
            this.addError(`Método encadenado desconocido "${chainCmd}".`,
              chainToken.line, chainToken.column, null, chainCmd,
              `Quizás quiso escribir: ${sim}`);
          }
        }
      }
    }

    return this.getResult();
  }

  parseJSON() {
    try {
      const parsed = JSON.parse(this.query);

      const keys = Object.keys(parsed);
      let isMongo = false;
      for (const cmd of MONGO_COMMANDS) {
        if (keys.includes(cmd)) {
          isMongo = true;
          break;
        }
      }
      if (!isMongo) {
         for (const k of keys) {
            if (k.startsWith('$')) isMongo = true;
         }
         if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
           const stage = Object.keys(parsed[0])[0];
           if (stage && (MONGO_OPERATOR_SET.has(stage) || stage.startsWith('$'))) {
             isMongo = true;
           }
         }
      }

      if (!isMongo) {
         this.addError(
           `JSON válido pero no parece una consulta MongoDB reconocida.`, 1, 1,
           null, null,
           'Usa comandos como "find", "aggregate", o operadores como "$match".'
         );
      } else {
         this.pos = 0;
         this.scanObjectAndCheckOperators(0, true);
      }
    } catch (e) {
      const match = e.message.match(/position (\d+)/);
      let line = 1; let col = 1;
      if (match) {
        const pos = parseInt(match[1], 10);
        const textBefore = this.query.substring(0, pos);
        line = (textBefore.match(/\n/g) || []).length + 1;
        col = pos - textBefore.lastIndexOf('\n');
      }
      this.addError(
        `Error parseando JSON: ${e.message}`, line, col, null, null,
        'Verifica la estructura JSON. Comillas dobles son obligatorias para llaves.'
      );
    }
    return this.getResult();
  }

  scanObjectAndCheckOperators(initialParenCount = 1, isJson = false) {
    let braceCount = 0;
    let bracketCount = 0;
    let parenCount = initialParenCount;

    // Context tracking: detect key vs value position
    // After '{' we're in key position. After ':' we're in value position.
    // After ',' inside an object, we're back to key position.
    let contextStack = []; // stack of 'object' | 'array'
    let inKeyPosition = false;

    while (this.peek().type !== TokenTypes.EOF) {
      const token = this.peek();

      if (token.value === '{') {
        braceCount++;
        contextStack.push('object');
        inKeyPosition = true;
      }
      if (token.value === '}') {
        braceCount--;
        if (braceCount < 0) {
          this.addError('Llave de cierre "}" inesperada o sobrando.',
            token.line, token.column, null, token.value,
            'Elimine esta llave o verifique las aperturas.');
          braceCount = 0;
        }
        if (contextStack.length > 0 && contextStack[contextStack.length - 1] === 'object') {
          contextStack.pop();
        }
        inKeyPosition = contextStack.length > 0 && contextStack[contextStack.length - 1] === 'object';
      }
      if (token.value === '[') {
        bracketCount++;
        contextStack.push('array');
        inKeyPosition = false;
      }
      if (token.value === ']') {
        bracketCount--;
        if (bracketCount < 0) {
          this.addError('Corchete de cierre "]" inesperado o sobrando.',
            token.line, token.column, null, token.value,
            'Elimine este corchete o verifique las aperturas.');
          bracketCount = 0;
        }
        if (contextStack.length > 0 && contextStack[contextStack.length - 1] === 'array') {
          contextStack.pop();
        }
        inKeyPosition = contextStack.length > 0 && contextStack[contextStack.length - 1] === 'object';
      }
      if (token.value === '(') parenCount++;
      if (token.value === ')') {
        if (!isJson) {
           parenCount--;
           if (parenCount === 0) break;
           if (parenCount < 0) {
             this.addError('Paréntesis de cierre ")" inesperado o sobrando.',
               token.line, token.column, null, token.value,
               'Elimine este paréntesis o verifique las aperturas.');
             parenCount = 0;
           }
        }
      }

      // Colon means we transition from key to value
      if (token.value === ':') {
        inKeyPosition = false;
      }

      // Comma: back to key position if inside object, stays value if array
      if (token.value === ',') {
        if (contextStack.length > 0 && contextStack[contextStack.length - 1] === 'object') {
          inKeyPosition = true;
        }
      }

      // Check $-prefixed tokens
      let valToCheck = token.value;
      if (token.type === TokenTypes.STRING) {
         valToCheck = valToCheck.replace(/^["']/, '').replace(/["']$/, '');
      }

      if (valToCheck.startsWith('$')) {
        if (inKeyPosition) {
          // In key position: must be a known operator
          if (!MONGO_KEY_OPERATORS.has(valToCheck) && !MONGO_OPERATOR_SET.has(valToCheck)) {
            const sim = findSimilar(valToCheck, MONGO_OPERATORS);
            if (sim) {
               this.addError(
                 `Operador MongoDB desconocido: ${valToCheck}`,
                 token.line, token.column, valToCheck, valToCheck,
                 `Quizás quiso escribir: ${sim}`
               );
            } else {
               this.addError(
                 `Operador MongoDB desconocido: ${valToCheck}`,
                 token.line, token.column, valToCheck, valToCheck,
                 'Asegúrese de escribir correctamente el operador (ej. $match).'
               );
            }
          }
        } else {
          // In value position: could be a field path reference like "$campo"
          // Only flag if it doesn't look like a field path AND isn't a known operator
          if (!isFieldPathReference(valToCheck) && !MONGO_OPERATOR_SET.has(valToCheck)) {
            const sim = findSimilar(valToCheck, MONGO_OPERATORS);
            if (sim) {
               this.addError(
                 `Operador MongoDB desconocido: ${valToCheck}`,
                 token.line, token.column, valToCheck, valToCheck,
                 `Quizás quiso escribir: ${sim}`
               );
            }
            // If no similar operator found, it's likely a field path — don't error
          }
        }
      }

      this.advance();
    }

    if (braceCount > 0) {
      this.addError('Falta cierre de llave.',
        this.tokens[this.tokens.length-2]?.line || 1,
        this.tokens[this.tokens.length-2]?.column || 1,
        null, null, 'Agregue } antes del final del objeto o pipeline.');
    }
    if (bracketCount > 0) {
      this.addError('Falta cierre de corchete.',
        this.tokens[this.tokens.length-2]?.line || 1,
        this.tokens[this.tokens.length-2]?.column || 1,
        null, null, 'Agregue ] antes del final del array.');
    }
    if (!isJson && parenCount > 1) {
      this.addError('Falta cierre de paréntesis.',
        this.tokens[this.tokens.length-2]?.line || 1,
        this.tokens[this.tokens.length-2]?.column || 1,
        null, null, 'Agregue ) para cerrar los argumentos.');
    }
  }

  getResult() {
    if (this.errors.length === 0) {
      this.suggestions.push(`✅ Sintaxis MongoDB correcta.`);
    } else if (this.errors[0] && this.errors[0].suggestion && !this.suggestions.includes(this.errors[0].suggestion)) {
      this.suggestions.push(this.errors[0].suggestion);
    }

    return {
      valid: this.errors.length === 0,
      dialect: 'MongoDB',
      confidence: 100,
      errors: this.errors,
      suggestions: this.suggestions
    };
  }
}

module.exports = { MongoParser };
