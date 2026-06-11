const { detectEngine, Engines } = require('./detector');
const { Lexer, TokenTypes } = require('../lexer');

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

function findSimilarKeyword(word) {
  const upper = word.toUpperCase();
  const keywords = ['SELECT', 'FROM', 'WHERE', 'UPDATE', 'DELETE', 'INSERT', 'GROUP', 'ORDER', 'HAVING'];
  for (let kw of keywords) {
    if (upper === kw) continue;
    const dist = levenshtein(upper, kw);
    if (dist <= 2 && upper.length >= 3) {
      if (dist === 1 || (dist === 2 && upper.length >= 4)) {
        return kw;
      }
    }
  }
  return null;
}

class SQLParser {
  constructor(query) {
    this.query = query;
    this.errors = [];
    this.suggestions = [];
  }

  parse() {
    if (!this.query || this.query.trim() === '') {
      this.errors.push({ line: 1, column: 1, message: 'La consulta está vacía.' });
      return this.getResult('SQL Estándar ANSI', 0, Object.values(Engines), []);
    }

    const lexer = new Lexer(this.query, false);
    const allTokens = lexer.tokenize();
    const tokens = allTokens.filter(t => t.type !== TokenTypes.COMMENT);

    const { engine, confidence, compatible, incompatible } = detectEngine(tokens, this.query);

    const syntaxAnalyzer = new RDPParser(tokens, engine);
    this.errors = syntaxAnalyzer.parse();

    return this.getResult(engine, confidence, compatible, incompatible);
  }

  getResult(engine, confidence, compatible, incompatible) {
    if (this.errors.length === 0) {
      if (engine === 'SQL Estándar ANSI') {
         this.suggestions.push(`✅ Sintaxis SQL Estándar ANSI.\nCompatible con:\n` + compatible.map(c => `✓ ${c}`).join('\n'));
      } else {
         let msg = `✅ Sintaxis SQL correcta para ${engine}.`;
         if (compatible && compatible.length > 0) {
             msg += `\n\nCompatible con:\n` + compatible.map(c => `✓ ${c}`).join('\n');
         }
         if (incompatible && incompatible.length > 0) {
             msg += `\n\nNo compatible con:\n` + incompatible.map(i => `✗ ${i.engine} (Uso de: ${i.reasons.join(', ')})`).join('\n');
         }
         this.suggestions.push(msg);
      }
    } else if (this.errors[0] && this.errors[0].suggestion && !this.suggestions.includes(this.errors[0].suggestion)) {
      this.suggestions.push(this.errors[0].suggestion);
    }

    return {
      valid: this.errors.length === 0,
      dialect: engine,
      confidence: confidence,
      compatible: compatible,
      incompatible: incompatible,
      errors: this.errors,
      suggestions: this.suggestions
    };
  }
}

class RDPParser {
  constructor(tokens, engine) {
    this.tokens = tokens;
    this.engine = engine;
    this.pos = 0;
    this.errors = [];
  }

  peek() {
    return this.pos >= this.tokens.length ? this.tokens[this.tokens.length - 1] : this.tokens[this.pos];
  }

  advance() {
    const t = this.peek();
    if (t.type !== TokenTypes.EOF) this.pos++;
    return t;
  }

  match(type, value = null) {
    const t = this.peek();
    if (t.type === type && (value === null || t.value.toUpperCase() === value.toUpperCase())) {
      return this.advance();
    }
    return null;
  }
  
  matchOneOf(type, values) {
    const t = this.peek();
    if (t.type === type && values.includes(t.value.toUpperCase())) {
      return this.advance();
    }
    return null;
  }

  expect(type, value = null, customExpectedMsg = null, customSugg = null) {
    const t = this.peek();
    if (t.type === type && (value === null || t.value.toUpperCase() === value.toUpperCase())) {
      return this.advance();
    }
    
    let expected = customExpectedMsg || (value ? value : type);
    this.reportError(`Motor: ${this.engine}`, t, expected, customSugg);
    throw new Error('ParseError');
  }

  reportError(msg, token, expected = '', suggestion = null) {
    if (this.errors.length > 0) return;
    let tokenValue = token.value || 'FIN_DE_CONSULTA';
    this.errors.push({
      engine: this.engine,
      line: token.line,
      column: token.column,
      message: `Error sintáctico.\nEncontrado: ${tokenValue}\nSe esperaba: ${expected}`,
      fragment: tokenValue,
      suggestion: suggestion || `Verifique la palabra clave o sintaxis. Se esperaba: ${expected}`
    });
  }

  checkTypoAndThrow(t, context) {
    if (t.type === TokenTypes.IDENTIFIER) {
      const sim = findSimilarKeyword(t.value);
      if (sim === context) {
        this.reportError(`Motor: ${this.engine}`, t, context, `Quizás quiso escribir ${context}`);
        throw new Error('ParseError');
      }
    }
  }

  parse() {
    try {
      while (this.peek().type !== TokenTypes.EOF) {
        if (this.match(TokenTypes.PUNCTUATION, ';')) continue;
        this.parseStatement();
        if (this.peek().type !== TokenTypes.EOF) {
           const t = this.peek();
           if (t.type === TokenTypes.IDENTIFIER) {
               const sim = findSimilarKeyword(t.value);
               if (sim) {
                   this.reportError(`Motor: ${this.engine}`, t, sim, `Quizás quiso escribir ${sim}`);
                   throw new Error('ParseError');
               }
           }
           this.expect(TokenTypes.PUNCTUATION, ';', 'Punto y coma (;) o Fin de consulta');
        }
      }
    } catch (e) {
      // Detener en el primer error
    }
    return this.errors;
  }

  parseStatement() {
    const t = this.peek();
    
    if (t.type === TokenTypes.IDENTIFIER) {
        const sim = findSimilarKeyword(t.value);
        if (sim === 'SELECT' || sim === 'UPDATE' || sim === 'DELETE' || sim === 'INSERT') {
            this.reportError(`Motor: ${this.engine}`, t, sim, `Quizás quiso escribir ${sim}`);
            throw new Error('ParseError');
        }
    }

    if (this.match(TokenTypes.KEYWORD, 'SELECT') || this.match(TokenTypes.KEYWORD, 'WITH')) {
       if (t.value.toUpperCase() === 'WITH') {
          if (this.match(TokenTypes.KEYWORD, 'RECURSIVE')) {}
          this.parseCTE();
          this.expect(TokenTypes.KEYWORD, 'SELECT');
       }
       this.parseSelectBody();
    } else if (this.match(TokenTypes.KEYWORD, 'INSERT')) {
       this.parseInsert();
    } else if (this.match(TokenTypes.KEYWORD, 'UPDATE')) {
       this.parseUpdate();
    } else if (this.match(TokenTypes.KEYWORD, 'DELETE')) {
       this.parseDelete();
    } else if (this.match(TokenTypes.KEYWORD, 'CREATE') || this.match(TokenTypes.KEYWORD, 'ALTER') || this.match(TokenTypes.KEYWORD, 'DROP') || this.match(TokenTypes.KEYWORD, 'TRUNCATE')) {
       const ddlCmd = t.value.toUpperCase();
       // Must have at least two tokens after DDL keyword (e.g., TABLE nombre_tabla)
       const nextT = this.peek();
       const nextNextT = this.tokens[this.pos] ? this.tokens[this.pos + 1] : null;
       
       if (nextT.type === TokenTypes.EOF || (nextT.type === TokenTypes.PUNCTUATION && nextT.value === ';') ||
           !nextNextT || nextNextT.type === TokenTypes.EOF || (nextNextT.type === TokenTypes.PUNCTUATION && nextNextT.value === ';')) {
          this.reportError(`Motor: ${this.engine}`, nextT,
            'Nombre de objeto',
            `${ddlCmd} requiere un tipo de objeto y un nombre (ej. ${ddlCmd} TABLE nombre_tabla)`);
          throw new Error('ParseError');
       }
       while(this.peek().type !== TokenTypes.EOF && !(this.peek().type === TokenTypes.PUNCTUATION && this.peek().value === ';')) {
          this.advance();
       }
    } else if (this.match(TokenTypes.KEYWORD, 'SHOW') || this.match(TokenTypes.KEYWORD, 'DESCRIBE') || this.match(TokenTypes.KEYWORD, 'PRAGMA')) {
       while(this.peek().type !== TokenTypes.EOF && !(this.peek().type === TokenTypes.PUNCTUATION && this.peek().value === ';')) {
          this.advance();
       }
    } else {
       this.expect(TokenTypes.KEYWORD, 'SELECT', 'Sentencia DML o DDL válida (SELECT, INSERT, UPDATE...)');
    }
  }

  parseCTE() {
    do {
       this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de CTE');
       if (this.match(TokenTypes.PUNCTUATION, '(')) {
          while(this.peek().type !== TokenTypes.EOF && this.peek().value !== ')') this.advance();
          this.expect(TokenTypes.PUNCTUATION, ')');
       }
       this.expect(TokenTypes.KEYWORD, 'AS');
       this.expect(TokenTypes.PUNCTUATION, '(');
       this.expect(TokenTypes.KEYWORD, 'SELECT');
       this.parseSelectBody();
       this.expect(TokenTypes.PUNCTUATION, ')');
    } while(this.match(TokenTypes.PUNCTUATION, ','));
  }

  parseSelectBody() {
    this.parseSelectList();
    
    if (this.match(TokenTypes.KEYWORD, 'INTO')) {
       this.parseIdentifierList();
    }
    
    this.checkTypoAndThrow(this.peek(), 'FROM');

    if (this.match(TokenTypes.KEYWORD, 'FROM')) {
       this.parseTableReferences();
       
       this.checkTypoAndThrow(this.peek(), 'WHERE');
       if (this.match(TokenTypes.KEYWORD, 'WHERE')) {
          this.parseExpression();
       }
       
       if (this.match(TokenTypes.KEYWORD, 'START')) {
          this.expect(TokenTypes.KEYWORD, 'WITH');
          this.parseExpression();
          this.expect(TokenTypes.KEYWORD, 'CONNECT');
          this.expect(TokenTypes.KEYWORD, 'BY');
          this.parseExpression();
       }
       
       this.checkTypoAndThrow(this.peek(), 'GROUP');
       if (this.match(TokenTypes.KEYWORD, 'GROUP')) {
          this.expect(TokenTypes.KEYWORD, 'BY');
          this.parseExpressionList();
          this.checkTypoAndThrow(this.peek(), 'HAVING');
          if (this.match(TokenTypes.KEYWORD, 'HAVING')) {
             this.parseExpression();
          }
       }
       
       if (this.match(TokenTypes.KEYWORD, 'WINDOW')) {
           this.expect(TokenTypes.IDENTIFIER);
           this.expect(TokenTypes.KEYWORD, 'AS');
           this.expect(TokenTypes.PUNCTUATION, '(');
           this.parseWindowDefinition();
           this.expect(TokenTypes.PUNCTUATION, ')');
       }

       this.checkTypoAndThrow(this.peek(), 'ORDER');
       if (this.match(TokenTypes.KEYWORD, 'ORDER')) {
          this.expect(TokenTypes.KEYWORD, 'BY');
          this.parseExpressionList(); 
       }
       
       if (this.match(TokenTypes.KEYWORD, 'LIMIT') || this.match(TokenTypes.KEYWORD, 'OFFSET') || this.match(TokenTypes.KEYWORD, 'FETCH')) {
           while(this.peek().type !== TokenTypes.EOF && this.peek().value !== ';') this.advance();
       }
    }
    
    if (this.match(TokenTypes.KEYWORD, 'UNION') || this.match(TokenTypes.KEYWORD, 'INTERSECT') || this.match(TokenTypes.KEYWORD, 'EXCEPT')) {
       if (this.match(TokenTypes.KEYWORD, 'ALL')) {}
       this.expect(TokenTypes.KEYWORD, 'SELECT');
       this.parseSelectBody();
    }
  }

  parseSelectList() {
    if (this.match(TokenTypes.STAR)) {
       if (this.match(TokenTypes.PUNCTUATION, ',')) {
          this.parseSelectList();
       }
       return;
    }
    
    if (this.match(TokenTypes.KEYWORD, 'DISTINCT') || this.match(TokenTypes.KEYWORD, 'ALL')) {}
    if (this.match(TokenTypes.KEYWORD, 'TOP')) {
       this.expect(TokenTypes.NUMBER);
    }
    
    do {
       this.parseExpression();
       if (this.match(TokenTypes.KEYWORD, 'AS')) {
          if (!this.match(TokenTypes.IDENTIFIER) && !this.match(TokenTypes.STRING)) {
              this.expect(TokenTypes.IDENTIFIER, null, 'Alias válido');
          }
       } else if (this.peek().type === TokenTypes.STRING) {
          // Implicit alias with string is usually okay (e.g., SELECT col 'Alias')
          this.advance();
       } else if (this.peek().type === TokenTypes.IDENTIFIER) {
          const t = this.peek();
          const sim = findSimilarKeyword(t.value);
          if (sim === 'FROM' && this.tokens[this.pos + 1] && (this.tokens[this.pos + 1].type === TokenTypes.IDENTIFIER || this.tokens[this.pos + 1].type === TokenTypes.KEYWORD)) {
             this.reportError(`Motor: ${this.engine}`, t, 'FROM', `Quizás quiso escribir FROM`);
             throw new Error('ParseError');
          }
          // Strict validation: Reject implicit identifier aliases to catch missing commas.
          // e.g. "SELECT nombre direccion" -> missing comma between nombre and direccion.
          this.reportError(`Motor: ${this.engine}`, t,
             'Coma (,) o AS',
             `Identificadores consecutivos detectados. Falta una coma antes de "${t.value}" o use 'AS' para alias.`);
          throw new Error('ParseError');
       }
       // After expression + optional alias: if next is a plain identifier (not keyword, not comma)
       // that means consecutive columns without comma separator
       if (this.peek().type === TokenTypes.IDENTIFIER) {
          const nextT = this.peek();
          const nextSim = findSimilarKeyword(nextT.value);
          if (!nextSim) {
             this.reportError(`Motor: ${this.engine}`, nextT,
               'Coma (,) o FROM',
               `Identificadores consecutivos sin separador. Falta una coma antes de "${nextT.value}".`);
             throw new Error('ParseError');
          }
       }
    } while (this.match(TokenTypes.PUNCTUATION, ','));
  }

  parseTableReferences() {
    do {
       if (this.match(TokenTypes.PUNCTUATION, '(')) {
          if (this.match(TokenTypes.KEYWORD, 'SELECT')) {
             this.parseSelectBody();
          } else {
             this.parseTableReferences();
          }
          this.expect(TokenTypes.PUNCTUATION, ')');
       } else {
          if (this.peek().type === TokenTypes.IDENTIFIER || this.peek().type === TokenTypes.KEYWORD) {
              this.advance();
              while (this.match(TokenTypes.DOT)) {
                  if (this.peek().type === TokenTypes.IDENTIFIER || this.peek().type === TokenTypes.KEYWORD) {
                      this.advance();
                  } else {
                      this.expect(TokenTypes.IDENTIFIER, null, 'Nombre después del punto');
                  }
              }
          } else {
              this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de tabla');
          }
       }
       
       if (this.match(TokenTypes.KEYWORD, 'AS')) {
          this.match(TokenTypes.IDENTIFIER);
       } else if (this.peek().type === TokenTypes.IDENTIFIER) {
          const sim = findSimilarKeyword(this.peek().value);
          if (sim === 'WHERE' || sim === 'JOIN') {
              this.reportError(`Motor: ${this.engine}`, this.peek(), sim, `Quizás quiso escribir ${sim}`);
              throw new Error('ParseError');
          }
          this.advance(); 
       }
       
       if (this.match(TokenTypes.KEYWORD, 'WITH')) {
           this.expect(TokenTypes.PUNCTUATION, '(');
           this.expect(TokenTypes.KEYWORD, 'NOLOCK');
           this.expect(TokenTypes.PUNCTUATION, ')');
       }
       
       while (this.isJoinKeyword()) {
          this.parseJoin();
       }
       
    } while (this.match(TokenTypes.PUNCTUATION, ','));
  }
  
  isJoinKeyword() {
    const t = this.peek();
    const up = t.value.toUpperCase();
    return t.type === TokenTypes.KEYWORD && ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(up);
  }

  parseJoin() {
     this.matchOneOf(TokenTypes.KEYWORD, ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS']);
     if (this.match(TokenTypes.KEYWORD, 'OUTER')) {}
     this.expect(TokenTypes.KEYWORD, 'JOIN');
     
     if (this.match(TokenTypes.PUNCTUATION, '(')) {
          this.parseSelectBody();
          this.expect(TokenTypes.PUNCTUATION, ')');
     } else {
          if (this.peek().type === TokenTypes.IDENTIFIER || this.peek().type === TokenTypes.KEYWORD) {
              this.advance();
              while (this.match(TokenTypes.DOT)) {
                  if (this.peek().type === TokenTypes.IDENTIFIER || this.peek().type === TokenTypes.KEYWORD) {
                      this.advance();
                  } else {
                      this.expect(TokenTypes.IDENTIFIER, null, 'Nombre después del punto');
                  }
              }
          } else {
              this.expect(TokenTypes.IDENTIFIER, null, 'Tabla para JOIN');
          }
     }
     
     if (this.match(TokenTypes.KEYWORD, 'AS')) {
        this.match(TokenTypes.IDENTIFIER);
     } else if (this.peek().type === TokenTypes.IDENTIFIER) {
        const sim = findSimilarKeyword(this.peek().value);
        if (sim === 'ON' || sim === 'WHERE') {
            this.reportError(`Motor: ${this.engine}`, this.peek(), sim, `Quizás quiso escribir ${sim}`);
            throw new Error('ParseError');
        }
        this.advance();
     }
     
     if (this.match(TokenTypes.KEYWORD, 'ON')) {
        this.parseExpression();
     } else if (this.match(TokenTypes.KEYWORD, 'USING')) {
        this.expect(TokenTypes.PUNCTUATION, '(');
        this.parseIdentifierList();
        this.expect(TokenTypes.PUNCTUATION, ')');
     }
  }

  parseInsert() {
    this.match(TokenTypes.KEYWORD, 'INTO');
    this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de tabla de inserción');
    if (this.match(TokenTypes.PUNCTUATION, '(')) {
       this.parseIdentifierList();
       this.expect(TokenTypes.PUNCTUATION, ')');
    }
    
    if (this.match(TokenTypes.KEYWORD, 'VALUES')) {
       do {
          this.expect(TokenTypes.PUNCTUATION, '(');
          this.parseExpressionList();
          this.expect(TokenTypes.PUNCTUATION, ')');
       } while (this.match(TokenTypes.PUNCTUATION, ','));
    } else if (this.match(TokenTypes.KEYWORD, 'SELECT')) {
       this.parseSelectBody();
    } else {
       this.expect(TokenTypes.KEYWORD, 'VALUES', 'VALUES o SELECT');
    }

    if (this.match(TokenTypes.KEYWORD, 'RETURNING')) {
       this.parseExpressionList();
    }
  }

  parseUpdate() {
    this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de tabla a actualizar');
    this.expect(TokenTypes.KEYWORD, 'SET');
    do {
       this.expect(TokenTypes.IDENTIFIER);
       this.expect(TokenTypes.OPERATOR, '=');
       this.parseExpression();
    } while(this.match(TokenTypes.PUNCTUATION, ','));
    
    this.checkTypoAndThrow(this.peek(), 'WHERE');
    if (this.match(TokenTypes.KEYWORD, 'WHERE')) {
       this.parseExpression();
    }

    if (this.match(TokenTypes.KEYWORD, 'RETURNING')) {
       this.parseExpressionList();
    }
  }

  parseDelete() {
    this.match(TokenTypes.KEYWORD, 'FROM');
    this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de tabla para borrar');
    
    this.checkTypoAndThrow(this.peek(), 'WHERE');
    if (this.match(TokenTypes.KEYWORD, 'WHERE')) {
       this.parseExpression();
    }

    if (this.match(TokenTypes.KEYWORD, 'RETURNING')) {
       this.parseExpressionList();
    }
  }

  parseIdentifierList() {
    do {
       this.expect(TokenTypes.IDENTIFIER, null, 'Identificador (columna)');
    } while(this.match(TokenTypes.PUNCTUATION, ','));
  }

  parseExpressionList() {
    do {
       this.parseExpression();
    } while(this.match(TokenTypes.PUNCTUATION, ','));
  }

  parseExpression() {
     let count = 0;
     while(true) {
        const t = this.peek();
        if (t.type === TokenTypes.EOF || t.value === ';' || t.value === ',' || t.value === ')' || 
            ['FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'AS', 'INTO', 'RETURNING'].includes(t.value.toUpperCase())) {
           break;
        }

        if (t.type === TokenTypes.IDENTIFIER) {
            const sim = findSimilarKeyword(t.value);
            if (sim) break; 
        }
        
        if (count > 0 && [TokenTypes.IDENTIFIER, TokenTypes.STRING, TokenTypes.NUMBER, TokenTypes.DATA_TYPE].includes(t.type)) {
            const prev = this.tokens[this.pos - 1];
            if (prev) {
                if (![TokenTypes.OPERATOR, TokenTypes.KEYWORD, TokenTypes.DOT, TokenTypes.DOUBLECOLON].includes(prev.type) && prev.value !== '(' && prev.value !== ',') {
                    break;
                }
                if (prev.type === TokenTypes.KEYWORD && ['NULL', 'TRUE', 'FALSE'].includes(prev.value.toUpperCase())) {
                    break;
                }
            }
        }
        
        if (t.type === TokenTypes.FUNCTION) {
           this.advance();
           this.expect(TokenTypes.PUNCTUATION, '(');
           if (!this.match(TokenTypes.PUNCTUATION, ')')) {
              if (this.match(TokenTypes.STAR)) {}
              else this.parseExpressionList();
              this.expect(TokenTypes.PUNCTUATION, ')');
           }
           count++;
        } else if (t.type === TokenTypes.WINDOW_FUNCTION) {
           this.advance();
           this.expect(TokenTypes.PUNCTUATION, '(');
           if (!this.match(TokenTypes.PUNCTUATION, ')')) {
              this.parseExpressionList();
              this.expect(TokenTypes.PUNCTUATION, ')');
           }
           this.expect(TokenTypes.KEYWORD, 'OVER');
           this.expect(TokenTypes.PUNCTUATION, '(');
           this.parseWindowDefinition();
           this.expect(TokenTypes.PUNCTUATION, ')');
           count++;
        } else if (t.type === TokenTypes.PUNCTUATION && t.value === '(') {
           this.advance();
           if (this.match(TokenTypes.KEYWORD, 'SELECT')) {
              this.parseSelectBody();
           } else {
              this.parseExpressionList();
           }
           this.expect(TokenTypes.PUNCTUATION, ')');
           count++;
        } else if (t.type === TokenTypes.KEYWORD && t.value.toUpperCase() === 'CASE') {
           this.parseCase();
           count++;
        } else if (t.type === TokenTypes.KEYWORD && ['EXISTS', 'IN', 'ANY', 'ALL'].includes(t.value.toUpperCase())) {
           this.advance();
           if (this.peek().value === '(') {
               this.advance();
               if (this.match(TokenTypes.KEYWORD, 'SELECT')) {
                   this.parseSelectBody();
               } else {
                   this.parseExpressionList();
               }
               this.expect(TokenTypes.PUNCTUATION, ')');
           }
           count++;
        } else if (t.type === TokenTypes.IDENTIFIER) {
           const next = this.tokens[this.pos + 1];
           if (next && next.value === '(') {
               this.reportError(`Motor: ${this.engine}`, t, 'Función válida (SUM, COUNT, etc.)', `Función desconocida "${t.value}". Verifique que la función esté bien escrita.`);
               throw new Error('ParseError');
           }
           this.advance();
           while (this.match(TokenTypes.DOT)) {
               if (!this.match(TokenTypes.IDENTIFIER) && !this.match(TokenTypes.STAR)) {
                   this.expect(TokenTypes.IDENTIFIER, null, 'Nombre de columna después del punto');
               }
           }
           count++;
        } else if (['NUMBER', 'STRING', 'OPERATOR', 'DATA_TYPE'].includes(t.type) || t.type === TokenTypes.KEYWORD || t.type === TokenTypes.STAR) {
           this.advance();
           count++;
        } else if (t.type === TokenTypes.DOUBLECOLON) {
           this.advance();
           if (!this.match(TokenTypes.DATA_TYPE) && !this.match(TokenTypes.IDENTIFIER)) {
               this.expect(TokenTypes.DATA_TYPE, null, 'Tipo de dato para CAST');
           }
           count++;
        } else {
           break;
        }
     }
     
     if (count === 0) {
        this.expect(TokenTypes.IDENTIFIER, null, 'Expresión válida');
     }
  }

  parseCase() {
     this.advance(); 
     if (!this.match(TokenTypes.KEYWORD, 'WHEN')) {
        this.parseExpression();
     } else {
        this.parseExpression();
        this.expect(TokenTypes.KEYWORD, 'THEN');
        this.parseExpression();
     }
     
     while(this.match(TokenTypes.KEYWORD, 'WHEN')) {
        this.parseExpression();
        this.expect(TokenTypes.KEYWORD, 'THEN');
        this.parseExpression();
     }
     if (this.match(TokenTypes.KEYWORD, 'ELSE')) {
        this.parseExpression();
     }
     this.expect(TokenTypes.KEYWORD, 'END');
  }

  parseWindowDefinition() {
     if (this.match(TokenTypes.KEYWORD, 'PARTITION')) {
        this.expect(TokenTypes.KEYWORD, 'BY');
        this.parseExpressionList();
     }
     if (this.match(TokenTypes.KEYWORD, 'ORDER')) {
        this.expect(TokenTypes.KEYWORD, 'BY');
        this.parseExpressionList();
     }
     if (this.match(TokenTypes.KEYWORD, 'ROWS') || this.match(TokenTypes.KEYWORD, 'RANGE')) {
        while(this.peek().type !== TokenTypes.EOF && this.peek().value !== ')') {
           this.advance();
        }
     }
  }

}

module.exports = { SQLParser };
