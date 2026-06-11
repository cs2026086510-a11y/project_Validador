const { validateSQL, validateNoSQL } = require('../../validation.service');

const validQueries = [
    // ALIAS
    "SELECT u.nombre, p.descripcion FROM usuarios u INNER JOIN pedidos p ON u.id = p.usuario_id WHERE u.activo = 1;",
    "SELECT db.tabla.columna FROM db.tabla;",
    "SELECT tabla.* FROM schema.tabla;",
    
    // JOIN
    "SELECT a.id FROM tabla_a a LEFT JOIN tabla_b b ON a.id = b.id;",
    "SELECT * FROM a FULL OUTER JOIN b ON a.x = b.y;",
    
    // CTE
    "WITH VentasCTE AS (SELECT empleado_id, SUM(monto) AS total_ventas FROM ventas GROUP BY empleado_id) SELECT * FROM VentasCTE;",
    "WITH RECURSIVE numeros AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numeros WHERE n < 10) SELECT * FROM numeros;",
    
    // Window Functions
    "SELECT RANK() OVER (PARTITION BY departamento ORDER BY salario DESC) FROM empleados;",
    "SELECT LEAD(fecha) OVER (ORDER BY id) FROM eventos;",
    
    // JSONB / UUID / RETURNING (PostgreSQL)
    "UPDATE usuarios SET metadata = '{\"theme\":\"dark\"}'::JSONB WHERE id = '550e8400-e29b-41d4-a716-446655440000'::UUID RETURNING id, nombre;",
    
    // TOP / NOLOCK (SQL Server)
    "SELECT TOP 10 id, nombre FROM clientes WITH (NOLOCK) WHERE id = NEWID();",
    
    // LIMIT (MySQL/Postgres/SQLite)
    "SELECT * FROM usuarios LIMIT 10 OFFSET 5;",
    
    // ROWNUM (Oracle)
    "SELECT * FROM (SELECT * FROM usuarios ORDER BY id) WHERE ROWNUM <= 10;",
    
    // SYSTIMESTAMP (Oracle)
    "SELECT SYSTIMESTAMP FROM DUAL;",
    
    // SQLite PRAGMA
    "PRAGMA foreign_keys = ON;",
];

const invalidQueries = [
    // Tipográficos
    { q: "SELECT nombre FORM usuarios;", expectError: "Quizás quiso escribir FROM" },
    { q: "SELCT * FROM tabla;", expectError: "Quizás quiso escribir SELECT" },
    { q: "UPDTE usuarios SET nombre = 'A';", expectError: "Quizás quiso escribir UPDATE" },
    { q: "SELECT * FROM tabla WERE id = 1;", expectError: "Quizás quiso escribir WHERE" },
    { q: "SELECT * FROM tabla ORDER BY id ODER;", expectError: "Quizás quiso escribir ORDER" }, 
    
    // Funciones
    { q: "SELECT S(monto) FROM ventas;", expectError: "Función desconocida \"S\"" },
    { q: "SELECT COUNTT(id) FROM tabla;", expectError: "Función desconocida \"COUNTT\"" },
    { q: "SELECT S() FROM t;", expectError: "Función desconocida \"S\"" },

    // Identificadores consecutivos (Falta coma)
    { q: "SELECT nombre direccion FROM usuarios;", expectError: "Coma (,) o AS" },
    { q: "SELECT a b c d FROM t;", expectError: "Coma (,) o AS" },

    // DDL incompleto
    { q: "CREATE TABLE;", expectError: "requiere un tipo de objeto" }
];

const validMongo = [
    '{\n "find":"usuarios",\n "filter":{\n   "edad":{\n      "$gte":18\n   }\n }\n}',
    'db.usuarios.aggregate([ { $match: { estado: "activo" } } ])',
    'db.pedidos.find({ "total": { $gt: 100 } })',
    'db.ventas.aggregate([ { $match: { anio: 2024 } }, { $group: { _id: "$categoria", total: { $sum: "$monto" } } } ])',
    'db.clientes.insertOne({ nombre: "María García", email: "maria@example.com", edad: 28, ciudad: "Madrid" })',
    'db.usuarios.updateOne( { _id: ObjectId("64abc123") }, { $set: { activo: false, fecha_baja: new Date() }, $inc: { intentos_login: 1 } } )'
];

const invalidMongo = [
    { q: '{\n "$gteee":18\n}', expectError: 'Quizás quiso escribir: $gte' },
    { q: 'db.usuarios.finnd({ })', expectError: 'Quizás quiso escribir: find' },
    { q: 'db.users.aggregate([ { $macth: {} } ])', expectError: 'Quizás quiso escribir: $match' },
    { q: 'db.usuarios.selectData({ activo: true })', expectError: 'Comando desconocido "selectData"' },
    { q: 'db.posts.find({ vistas: { $mayorQue: 100 } })', expectError: 'desconocido' }
];

let passed = 0;
let total = validQueries.length + invalidQueries.length + validMongo.length + invalidMongo.length;

console.log("=== INICIANDO TESTS DE VALIDACIÓN SQL Y MONGODB ===");

console.log("\n--- CASOS VÁLIDOS SQL ---");
for (let q of validQueries) {
    const result = validateSQL(q);
    if (result.valid) {
        passed++;
        console.log(`[PASS] ${q.substring(0, 50)}...`);
    } else {
        console.log(`[FAIL] ${q}`);
        console.log(`   Esperado: Válido, Obtuvo: Inválido`);
        console.log(`   Errores: `, result.errors[0].message);
    }
}

console.log("\n--- CASOS INVÁLIDOS SQL ---");
for (let test of invalidQueries) {
    const result = validateSQL(test.q);
    if (!result.valid) {
        if (result.errors[0].message.includes(test.expectError) || (result.errors[0].suggestion && result.errors[0].suggestion.includes(test.expectError))) {
            passed++;
            console.log(`[PASS] ${test.q.substring(0, 50)}...`);
        } else {
            console.log(`[FAIL] ${test.q}`);
            console.log(`   Esperado error conteniendo: ${test.expectError}`);
            console.log(`   Obtuvo: ${result.errors[0].message} / Sugerencia: ${result.errors[0].suggestion}`);
        }
    } else {
        console.log(`[FAIL] ${test.q}`);
        console.log(`   Esperado: Inválido, Obtuvo: Válido`);
    }
}

console.log("\n--- CASOS VÁLIDOS MONGODB ---");
for (let q of validMongo) {
    const result = validateNoSQL(q);
    if (result.valid) {
        passed++;
        console.log(`[PASS] ${q.substring(0, 50).replace(/\n/g, '')}...`);
    } else {
        console.log(`[FAIL] ${q}`);
        console.log(`   Esperado: Válido, Obtuvo: Inválido`);
        console.log(`   Errores: `, result.errors[0].message);
    }
}

console.log("\n--- CASOS INVÁLIDOS MONGODB ---");
for (let test of invalidMongo) {
    const result = validateNoSQL(test.q);
    if (!result.valid) {
        if (result.errors[0].message.includes(test.expectError) || (result.errors[0].suggestion && result.errors[0].suggestion.includes(test.expectError))) {
            passed++;
            console.log(`[PASS] ${test.q.substring(0, 50).replace(/\n/g, '')}...`);
        } else {
            console.log(`[FAIL] ${test.q}`);
            console.log(`   Esperado error conteniendo: ${test.expectError}`);
            console.log(`   Obtuvo: ${result.errors[0].message} / Sugerencia: ${result.errors[0].suggestion}`);
        }
    } else {
        console.log(`[FAIL] ${test.q}`);
        console.log(`   Esperado: Inválido, Obtuvo: Válido`);
    }
}

const precision = Math.round((passed / total) * 100);
console.log(`\n=== RESULTADO FINAL ===`);
console.log(`Pruebas ejecutadas: ${total}`);
console.log(`Pruebas aprobadas:  ${passed}`);
console.log(`Precisión:          ${precision}%`);

if (precision >= 90) {
    console.log("✅ Objetivo de precisión superado (>90%).");
} else {
    console.log("❌ No se alcanzó el objetivo de precisión.");
    process.exit(1);
}
