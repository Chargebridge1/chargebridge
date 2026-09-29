const IDENTIFIER = /^"?([a-z_][a-z0-9_]*)"?$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function identifier(value) {
  const match = String(value).trim().match(IDENTIFIER);
  assert(match, `Unsupported SQL identifier in approved catalog definition: ${value}`);
  return match[1].toLowerCase();
}

function stripComments(sql) {
  let output = "";
  let single = false;
  let double = false;
  let lineComment = false;
  let blockDepth = 0;
  let dollarTag = null;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockDepth) {
      if (char === "/" && next === "*") {
        blockDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        output += char;
      }
      continue;
    }
    if (!single && !double && char === "$") {
      const match = sql.slice(index).match(/^\$[a-z_][a-z0-9_]*\$|^\$\$/i);
      if (match) {
        dollarTag = match[0];
        output += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (!single && !double && char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!single && !double && char === "/" && next === "*") {
      blockDepth = 1;
      index += 1;
      continue;
    }
    output += char;
    if (!double && char === "'" && sql[index - 1] !== "\\") {
      if (single && next === "'") {
        output += next;
        index += 1;
      } else {
        single = !single;
      }
    } else if (!single && char === '"') {
      if (double && next === '"') {
        output += next;
        index += 1;
      } else {
        double = !double;
      }
    }
  }
  return output;
}

function findClosingParen(text, openIndex) {
  let depth = 0;
  let single = false;
  let double = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (!double && char === "'") {
      if (single && next === "'") {
        index += 1;
      } else {
        single = !single;
      }
      continue;
    }
    if (!single && char === '"') {
      if (double && next === '"') {
        index += 1;
      } else {
        double = !double;
      }
      continue;
    }
    if (single || double) continue;
    if (char === "(") depth += 1;
    if (char === ")" && --depth === 0) return index;
  }
  throw new Error("Unbalanced approved SQL definition");
}

function splitTopLevel(text, delimiter = ",") {
  const result = [];
  let start = 0;
  let depth = 0;
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (!double && char === "'") {
      if (single && next === "'") index += 1;
      else single = !single;
      continue;
    }
    if (!single && char === '"') {
      if (double && next === '"') index += 1;
      else double = !double;
      continue;
    }
    if (single || double) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === delimiter && depth === 0) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

function transformOutsideStringLiterals(expression, transform) {
  let result = "";
  let segment = "";
  let single = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    if (char === "'") {
      if (!single) {
        result += transform(segment);
        segment = "";
      }
      segment += char;
      if (single && next === "'") {
        segment += next;
        index += 1;
      } else {
        single = !single;
        if (!single) {
          result += segment;
          segment = "";
        }
      }
    } else {
      segment += char;
    }
  }
  return result + transform(segment);
}

function maskSqlStringLiterals(expression) {
  let masked = "";
  let single = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    if (char === "'") {
      masked += " ";
      if (single && next === "'") {
        masked += " ";
        index += 1;
      } else {
        single = !single;
      }
    } else {
      masked += single ? " " : char;
    }
  }
  return masked;
}

function normalizeInPredicates(expression) {
  const masked = maskSqlStringLiterals(expression);
  const pattern = /([a-z_][a-z0-9_.]*)\s+(NOT\s+)?IN\s*\(([^()]*)\)/gi;
  const matches = [...masked.matchAll(pattern)];
  let result = expression;
  for (const match of matches.reverse()) {
    const open = match.index + match[0].indexOf("(");
    const close = match.index + match[0].length - 1;
    const values = result.slice(open + 1, close);
    const replacement = match[2]
      ? `${match[1]} <> ALL (ARRAY[${values}])`
      : `${match[1]} = ANY (ARRAY[${values}])`;
    result = `${result.slice(0, match.index)}${replacement}${result.slice(close + 1)}`;
  }
  return result;
}

function normalizeBetweenPredicates(expression) {
  const masked = maskSqlStringLiterals(expression);
  const pattern =
    /((?:[a-z_][a-z0-9_]*\([^()]*\)|[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?))\s+BETWEEN\s+(-?\d+)\s+AND\s+(-?\d+)/gi;
  const matches = [...masked.matchAll(pattern)];
  let result = expression;
  for (const match of matches.reverse()) {
    const replacement = `(${match[1]} >= ${match[2]} AND ${match[1]} <= ${match[3]})`;
    result = `${result.slice(0, match.index)}${replacement}${result.slice(match.index + match[0].length)}`;
  }
  return result;
}

function normalizeType(value) {
  const type = value.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s*,\s*/g, ",");
  const aliases = {
    int: "integer",
    int4: "integer",
    int8: "bigint",
    int2: "smallint",
    bool: "boolean",
    float4: "real",
    float8: "double precision",
    timestamptz: "timestamp with time zone",
    timestamp: "timestamp without time zone",
    serial: "integer",
    bigserial: "bigint",
    smallserial: "smallint",
  };
  return aliases[type] ?? type;
}

function findModifierOffset(text) {
  const pattern = /\b(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|COLLATE|GENERATED|IDENTITY)\b/i;
  return pattern.exec(text)?.index ?? text.length;
}

function normalizeLiteralQuotes(value) {
  return value.replaceAll("''", "'");
}

function parseColumn(raw, table) {
  const match = raw.match(/^\s*("?[\w]+"?)\s+([\s\S]*)$/);
  assert(match, `Could not parse approved column definition: ${raw}`);
  const name = identifier(match[1]);
  const rest = match[2].trim();
  const typeEnd = findModifierOffset(rest);
  const sourceType = rest.slice(0, typeEnd).trim();
  assert(sourceType, `Column ${table}.${name} has no declared type`);
  const type = normalizeType(sourceType);
  const tail = rest.slice(typeEnd);
  assert(!/\b(?:GENERATED|IDENTITY|COLLATE|CONSTRAINT|CHECK)\b/i.test(tail),
    `Unsupported approved column modifier on ${table}.${name}`);
  const serial = /^(?:smallserial|serial|bigserial)$/i.test(sourceType);
  const defaultMatch = tail.match(
    /\bDEFAULT\s+([\s\S]*?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|COLLATE|GENERATED|IDENTITY)\b|$)/i,
  );
  let defaultValue = defaultMatch ? defaultMatch[1].trim() : null;
  if (serial) defaultValue = `nextval('${table}_${name}_seq'::regclass)`;
  const column = {
    name,
    type,
    notNull: /\bNOT\s+NULL\b/i.test(tail) || /\bPRIMARY\s+KEY\b/i.test(tail),
    default: defaultValue,
  };
  const inlineConstraints = [];
  if (/\bPRIMARY\s+KEY\b/i.test(tail)) {
    inlineConstraints.push({
      name: `${table}_pkey`,
      type: "p",
      definition: `PRIMARY KEY (${name})`,
      keyColumns: [name],
    });
  }
  if (/\bUNIQUE\b/i.test(tail)) {
    inlineConstraints.push({
      name: `${table}_${name}_key`,
      type: "u",
      definition: `UNIQUE (${name})`,
      keyColumns: [name],
    });
  }
  const reference = tail.match(
    /\bREFERENCES\s+((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s*\(([^)]+)\)([\s\S]*)/i,
  );
  if (reference) {
    const targetTable = identifier(reference[1].split(".").at(-1));
    const targetColumns = splitTopLevel(reference[2]).map(identifier);
    const deleteAction = reference[3].match(/\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
      ?.replace(/\s+/g, " ").toUpperCase();
    const updateAction = reference[3].match(/\bON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
      ?.replace(/\s+/g, " ").toUpperCase();
    let definition = `FOREIGN KEY (${name}) REFERENCES ${targetTable} (${targetColumns.join(", ")})`;
    if (deleteAction && deleteAction !== "NO ACTION") definition += ` ON DELETE ${deleteAction}`;
    if (updateAction && updateAction !== "NO ACTION") definition += ` ON UPDATE ${updateAction}`;
    inlineConstraints.push({
      name: `${table}_${name}_fkey`,
      type: "f",
      definition,
    });
  }
  return { column, inlineConstraints };
}

function parseConstraint(raw, table, explicitName = null) {
  let definition = raw.trim();
  let name = explicitName;
  const named = definition.match(/^CONSTRAINT\s+("?[\w]+"?)\s+([\s\S]*)$/i);
  if (named) {
    name = identifier(named[1]);
    definition = named[2].trim();
  }
  const primary = definition.match(/^PRIMARY\s+KEY\s*\(([\s\S]*)\)$/i);
  if (primary) {
    const columns = splitTopLevel(primary[1]).map((column) =>
      identifier(column.replace(/\s+(?:ASC|DESC)(?:\s+NULLS\s+(?:FIRST|LAST))?$/i, "")));
    name ??= `${table}_pkey`;
    return { name, type: "p", definition: `PRIMARY KEY (${columns.join(", ")})`, keyColumns: columns };
  }
  const unique = definition.match(/^UNIQUE\s*\(([\s\S]*)\)$/i);
  if (unique) {
    const columns = splitTopLevel(unique[1]).map((column) =>
      identifier(column.replace(/\s+(?:ASC|DESC)(?:\s+NULLS\s+(?:FIRST|LAST))?$/i, "")));
    name ??= `${table}_${columns.join("_")}_key`;
    return { name, type: "u", definition: `UNIQUE (${columns.join(", ")})`, keyColumns: columns };
  }
  if (/^FOREIGN\s+KEY\b/i.test(definition)) {
    const fk = definition.match(
      /^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s*\(([^)]+)\)([\s\S]*)$/i,
    );
    assert(fk, `Could not parse foreign key definition: ${raw}`);
    const columns = splitTopLevel(fk[1]).map(identifier);
    const targetTable = identifier(fk[2].split(".").at(-1));
    const targetColumns = splitTopLevel(fk[3]).map(identifier);
    const actions = fk[4];
    const deleteAction = actions.match(/\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
      ?.replace(/\s+/g, " ").toUpperCase();
    const updateAction = actions.match(/\bON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b/i)?.[1]
      ?.replace(/\s+/g, " ").toUpperCase();
    let normalized = `FOREIGN KEY (${columns.join(", ")}) REFERENCES ${targetTable} (${targetColumns.join(", ")})`;
    if (deleteAction && deleteAction !== "NO ACTION") normalized += ` ON DELETE ${deleteAction}`;
    if (updateAction && updateAction !== "NO ACTION") normalized += ` ON UPDATE ${updateAction}`;
    name ??= `${table}_${columns.join("_")}_fkey`;
    return { name, type: "f", definition: normalized, keyColumns: columns };
  }
  if (/^CHECK\s*\(/i.test(definition)) {
    const checkName = name ?? `${table}_check`;
    return { name: checkName, type: "c", definition };
  }
  throw new Error(`Unsupported approved table constraint: ${raw}`);
}

function createEmptyTable(name) {
  return { name, columns: [], constraints: [] };
}

function parseCreateTables(sql, model) {
  const pattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = identifier(match[1].split(".").at(-1));
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = findClosingParen(sql, openIndex);
    const body = sql.slice(openIndex + 1, closeIndex);
    const tableModel = createEmptyTable(table);
    for (const item of splitTopLevel(body)) {
      if (/^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(item)) {
        const constraint = parseConstraint(item, table);
        tableModel.constraints.push(constraint);
        model.constraints.push({ table, ...constraint });
        if (constraint.type === "p") {
          for (const column of constraint.keyColumns) {
            const target = tableModel.columns.find((entry) => entry.name === column);
            if (target) target.notNull = true;
          }
        }
        continue;
      }
      const { column, inlineConstraints } = parseColumn(item, table);
      tableModel.columns.push(column);
      for (const constraint of inlineConstraints) {
        tableModel.constraints.push(constraint);
        model.constraints.push({ table, ...constraint });
      }
    }
    assert(!model.tables.some((entry) => entry.name === table),
      `Duplicate CREATE TABLE definition for ${table}`);
    model.tables.push(tableModel);
  }
}

function parseAlterTables(sql, model) {
  const pattern = /\bALTER\s+TABLE\s+(?:ONLY\s+)?((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s+ADD\s+(?:COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*?)|CONSTRAINT\s+("?[\w]+"?)\s+([\s\S]*?));/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = identifier(match[1].split(".").at(-1));
    if (match[2]) {
      const { column, inlineConstraints } = parseColumn(match[2], table);
      model.alteredColumns.push({ table, ...column });
      for (const constraint of inlineConstraints) {
        model.constraints.push({ table, ...constraint });
      }
    } else {
      const constraint = parseConstraint(match[4], table, identifier(match[3]));
      model.constraints.push({ table, ...constraint });
    }
  }
}

function parseEnumTypes(sql, model) {
  const pattern = /\bCREATE\s+TYPE\s+(?:(?:"?public"?|\w+)\.)?("?[\w]+"?)\s+AS\s+ENUM\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = identifier(match[1]);
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = findClosingParen(sql, openIndex);
    const labels = splitTopLevel(sql.slice(openIndex + 1, closeIndex)).map((value) => {
      const label = value.trim();
      assert(/^'(?:[^']|'')*'$/.test(label), `Unsupported enum label in ${name}`);
      return normalizeLiteralQuotes(label.slice(1, -1));
    });
    model.enums.push({ name, labels });
  }
}

function parseIndex(sql, match, model) {
  const name = identifier(match[2]);
  const table = identifier(match[3].split(".").at(-1));
  const method = (match[4] ?? "btree").toLowerCase();
  const openIndex = match.index + match[0].lastIndexOf("(");
  const closeIndex = findClosingParen(sql, openIndex);
  const keys = splitTopLevel(sql.slice(openIndex + 1, closeIndex)).map((key) => {
    const parsed = key.match(/^\s*("?[\w]+"?)(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?\s*$/i);
    assert(parsed, `Unsupported expression index key in ${name}: ${key}`);
    return {
      name: identifier(parsed[1]),
      descending: parsed[2]?.toUpperCase() === "DESC",
      nullsFirst: parsed[3]
        ? parsed[3].toUpperCase() === "FIRST"
        : parsed[2]?.toUpperCase() === "DESC",
    };
  });
  const tail = sql.slice(closeIndex + 1, sql.indexOf(";", closeIndex) < 0 ? undefined : sql.indexOf(";", closeIndex));
  const predicate = tail.match(/\bWHERE\s+([\s\S]*)$/i)?.[1]?.trim() ?? null;
  model.indexes.push({
    name,
    table,
    unique: Boolean(match[1]),
    primary: false,
    method,
    keys,
    predicate,
    immediate: true,
    nullsNotDistinct: false,
    exclusion: false,
    storageParameters: [],
  });
}

function parseIndexes(sql, model) {
  const pattern = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)\s+ON\s+((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s+(?:USING\s+([a-z_][a-z0-9_]*)\s*)?\(/gi;
  for (const match of sql.matchAll(pattern)) parseIndex(sql, match, model);
}

function parseFunctions(sql, model) {
  const pattern = /\bCREATE\s+FUNCTION\s+("?[\w]+"?)\s*\(([^)]*)\)\s+RETURNS\s+([a-z_][a-z0-9_]*)\s+LANGUAGE\s+([a-z_][a-z0-9_]*)\s+AS\s+(\$[a-z_][a-z0-9_]*\$|\$\$)([\s\S]*?)\5\s*;/gi;
  for (const match of sql.matchAll(pattern)) {
    model.functions.push({
      name: identifier(match[1]),
      arguments: match[2].trim(),
      returns: normalizeType(match[3]),
      language: match[4].toLowerCase(),
      source: match[6],
      strict: /\bSTRICT\b/i.test(match[0]),
      securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(match[0]),
      volatility: "v",
      parallel: "u",
      leakproof: false,
      returnsSet: false,
      config: null,
    });
  }
}

function parseTriggers(sql, model) {
  const pattern = /\bCREATE\s+TRIGGER\s+("?[\w]+"?)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\w\s]+?)\s+ON\s+((?:(?:"?public"?|\w+)\.)?"?[\w]+"?)\s+FOR\s+EACH\s+(ROW|STATEMENT)\s+EXECUTE\s+FUNCTION\s+("?[\w]+"?)\s*\([^)]*\)\s*;/gi;
  for (const match of sql.matchAll(pattern)) {
    model.triggers.push({
      name: identifier(match[1]),
      timing: match[2].replace(/\s+/g, " ").toUpperCase(),
      events: match[3].trim().toUpperCase().split(/\s+OR\s+/),
      table: identifier(match[4].split(".").at(-1)),
      level: match[5].toLowerCase(),
      function: identifier(match[6]),
      enabled: "O",
    });
  }
}

export function parseExpectedCatalog(sql) {
  const source = stripComments(sql);
  const model = {
    tables: [],
    alteredColumns: [],
    constraints: [],
    enums: [],
    indexes: [],
    functions: [],
    triggers: [],
  };
  parseCreateTables(source, model);
  parseAlterTables(source, model);
  parseEnumTypes(source, model);
  parseIndexes(source, model);
  parseFunctions(source, model);
  parseTriggers(source, model);
  for (const table of model.tables) {
    assert(table.columns.length > 0, `Approved table ${table.name} has no columns`);
    assert(new Set(table.columns.map((column) => column.name)).size === table.columns.length,
      `Approved table ${table.name} has duplicate column declarations`);
    for (const constraint of model.constraints.filter((entry) => entry.table === table.name)) {
      if (!table.constraints.some((entry) => entry.name === constraint.name)) {
        table.constraints.push(constraint);
      }
    }
  }
  return model;
}

function canonicalExpression(value, { castTypes = [] } = {}) {
  if (value == null) return null;
  let result = transformOutsideStringLiterals(String(value).trim(), (segment) =>
    segment.replace(/\bNOT\s+ILIKE\b/gi, "!~~*")
      .replace(/\bILIKE\b/gi, "~~*")
      .replace(/\bNOT\s+LIKE\b/gi, "!~~")
      .replace(/\bLIKE\b/gi, "~~"));
  result = normalizeInPredicates(result);
  result = normalizeBetweenPredicates(result);
  result = result.replace(
    /(?<!')'(\d+(?:\.\d+)?\s*(?:second|minute|hour|day|week|month|year)s?)'(?!')::interval\b/gi,
    "interval '$1'",
  );
  result = result.replace(
    /(?<!')'(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)'(?!')::numeric\b/gi,
    "$1",
  );
  result = transformOutsideStringLiterals(result, (segment) => {
    for (const castType of castTypes) {
      const escaped = castType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      segment = segment.replace(
        new RegExp(`::\\s*(?:public\\.)?${escaped}(?:\\[\\])?\\b`, "ig"),
        "",
      );
    }
    return segment.replace(/\(?(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\)?::numeric\b/gi, "$1");
  });
  result = transformOutsideStringLiterals(result, (segment) =>
    segment.replace(/"([a-z_][a-z0-9_]*)"/gi, "$1"));
  let normalized = "";
  let single = false;
  for (let index = 0; index < result.length; index += 1) {
    const char = result[index];
    const next = result[index + 1];
    if (char === "'") {
      normalized += char;
      if (single && next === "'") {
        normalized += next;
        index += 1;
      } else {
        single = !single;
      }
    } else {
      normalized += single ? char : char.toLowerCase();
    }
  }
  normalized = normalized.replace(/\s+/g, " ")
    .replace(/\s*([(),.=<>+\-*/])\s*/g, "$1")
    .replace(/,\s*/g, ",")
    .trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    const close = findClosingParen(normalized, 0);
    if (close !== normalized.length - 1) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return stripRedundantBooleanGrouping(normalized);
}

function rootBooleanPrecedence(expression) {
  let depth = 0;
  let single = false;
  let hasAnd = false;
  let hasOr = false;
  let hasComparison = false;
  let hasAddition = false;
  let hasMultiplication = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    if (char === "'") {
      if (single && next === "'") index += 1;
      else single = !single;
      continue;
    }
    if (single) continue;
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    const word = expression.slice(index).match(/^(and|or|is|in|like|between)\b/i)?.[1]?.toLowerCase();
    if (word === "and") hasAnd = true;
    else if (word === "or") hasOr = true;
    else if (word) hasComparison = true;
    else if ("=<>!".includes(char)) hasComparison = true;
    else if (char === "+" || char === "-") hasAddition = true;
    else if (char === "*" || char === "/") hasMultiplication = true;
  }
  if (hasOr) return { precedence: 1, operator: "or" };
  if (hasAnd) return { precedence: 2, operator: "and" };
  if (hasComparison) return { precedence: 3, operator: null };
  if (hasAddition) return { precedence: 4, operator: null };
  if (hasMultiplication) return { precedence: 5, operator: null };
  return { precedence: 6, operator: null };
}

function adjacentOperator(expression, side) {
  const source = side === "left" ? expression.trimEnd() : expression.trimStart();
  const word = side === "left"
    ? source.match(/\b(and|or|is|in|like|between)$/i)?.[1]
    : source.match(/^(and|or|is|in|like|between)\b/i)?.[1];
  if (word) return word.toLowerCase();
  const symbol = side === "left"
    ? source.match(/(>=|<=|<>|!=|=|>|<|\+|-|\*|\/)$/)?.[1]
    : source.match(/^(>=|<=|<>|!=|=|>|<|\+|-|\*|\/)/)?.[1];
  return symbol ?? null;
}

function spaceBooleanKeywords(expression) {
  let result = "";
  let single = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    if (char === "'") {
      result += char;
      if (single && next === "'") {
        result += next;
        index += 1;
      } else {
        single = !single;
      }
      continue;
    }
    if (!single) {
      const keyword = expression.slice(index).match(/^(and|or)\b/i)?.[1];
      if (keyword) {
        if (result && !/\s$/.test(result)) result += " ";
        result += keyword.toLowerCase();
        index += keyword.length - 1;
        if (index + 1 < expression.length && !/\s/.test(expression[index + 1])) result += " ";
        continue;
      }
    }
    result += char;
  }
  return result;
}

function stripRedundantBooleanGrouping(expression) {
  let normalized = expression;
  let changed = true;
  while (changed) {
    changed = false;
    const groups = [];
    const stack = [];
    let single = false;
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      const next = normalized[index + 1];
      if (char === "'") {
        if (single && next === "'") index += 1;
        else single = !single;
      } else if (!single && char === "(") {
        stack.push(index);
      } else if (!single && char === ")" && stack.length) {
        groups.push({ start: stack.pop(), end: index });
      }
    }
    for (const { start, end } of groups) {
      const preceding = normalized.slice(0, start);
      const following = normalized.slice(end + 1);
      const precedingWord = preceding.trimEnd().match(/([a-z_][a-z0-9_]*)$/i)?.[1]?.toLowerCase();
      if (/[a-z_0-9"]$/i.test(preceding.trimEnd()) &&
          !["and", "or", "not"].includes(precedingWord)) continue;
      const leftOperator = adjacentOperator(preceding, "left");
      const rightOperator = adjacentOperator(following, "right");
      const contexts = [leftOperator, rightOperator].filter(Boolean);
      if (!contexts.length) continue;

      const own = rootBooleanPrecedence(normalized.slice(start + 1, end));
      const redundant = contexts.every((context) => {
        const contextPrecedence = ["or", "and", "is", "in", "like", "between"].includes(context)
          ? context === "or" ? 1 : context === "and" ? 2 : 3
          : ["=", ">", "<", ">=", "<=", "<>", "!="].includes(context) ? 3
          : ["+", "-"].includes(context) ? 4
          : 5;
        return own.precedence > contextPrecedence ||
          (own.precedence === contextPrecedence &&
            ["and", "or"].includes(own.operator) && own.operator === context);
      });
      if (!redundant) continue;

      const prefix = normalized.slice(0, start);
      const content = normalized.slice(start + 1, end);
      const suffix = normalized.slice(end + 1);
      const needsSpace = (left, right) => /[a-z0-9_]$/i.test(left) && /^[a-z0-9_]/i.test(right);
      normalized = `${prefix}${needsSpace(prefix, content) ? " " : ""}${content}${
        needsSpace(content, suffix) ? " " : ""
      }${suffix}`;
      changed = true;
      break;
    }
  }
  return spaceBooleanKeywords(normalized);
}

function canonicalConstraint(value, enumTypes = []) {
  let definition = String(value).trim();
  definition = definition.replace(/\s+NOT\s+VALID$/i, "");
  const check = definition.match(/^CHECK\s*\(([\s\S]*)\)$/i);
  if (check) {
    return `check(${canonicalExpression(check[1], {
      castTypes: ["text", "character varying", ...enumTypes],
    })})`;
  }
  return canonicalExpression(definition, { castTypes: ["text", "character varying", ...enumTypes] });
}

function canonicalDefault(value, type) {
  if (value == null) return null;
  let expression = String(value);
  const normalizedType = normalizeType(type);
  const castTypes = [normalizedType.replace(/\(.*/, "")];
  if (["text", "character varying", "character"].includes(normalizedType)) {
    castTypes.push("text", "character varying");
  }
  return canonicalExpression(expression, { castTypes });
}

function canonicalIndexPredicate(value, enumTypes = []) {
  return canonicalExpression(value, { castTypes: ["text", "character varying", ...enumTypes] });
}

function compareList(actual, expected, key, label, normalizer = (value) => value) {
  const actualValues = actual.map((item) => normalizer(item)).sort();
  const expectedValues = expected.map((item) => normalizer(item)).sort();
  const actualOnly = actualValues.filter((value) => !expectedValues.includes(value));
  const expectedOnly = expectedValues.filter((value) => !actualValues.includes(value));
  assert(JSON.stringify(actualValues) === JSON.stringify(expectedValues),
    `${label} catalog definition mismatch (${key}); actual-only=${JSON.stringify(actualOnly)} expected-only=${JSON.stringify(expectedOnly)}`);
}

function constraintSignature(constraint, enumTypes = []) {
  return {
    name: constraint.name,
    type: constraint.type,
    definition: canonicalConstraint(constraint.definition, enumTypes),
    validated: constraint.validated !== false,
    deferrable: constraint.deferrable === true,
    deferred: constraint.deferred === true,
  };
}

function compareConstraint(actual, expected, label, enumTypes) {
  const actualSignatures = actual.map((constraint) => constraintSignature(constraint, enumTypes));
  const expectedSignatures = expected.map((constraint) => constraintSignature({
    ...constraint,
    validated: true,
    deferrable: false,
    deferred: false,
  }, enumTypes));
  compareList(actualSignatures, expectedSignatures, "constraints", label,
    (value) => JSON.stringify(value));
}

export function assertIndexCatalogParity(actual, expected, label, enumTypes = []) {
  const keys = actual?.keys ?? [];
  const sameKeys = keys.length === expected.keys.length &&
    keys.every((key, index) => key.name === expected.keys[index].name &&
      key.descending === expected.keys[index].descending &&
      key.nullsFirst === expected.keys[index].nullsFirst &&
      key.opclassDefault === true &&
      key.collationDefault === true);
  assert(actual && actual.name === expected.name &&
    actual.table === expected.table &&
    actual.unique === expected.unique &&
    actual.primary === expected.primary &&
    actual.immediate === expected.immediate &&
    actual.nullsNotDistinct === expected.nullsNotDistinct &&
    actual.exclusion === expected.exclusion &&
    JSON.stringify(actual.storageParameters ?? []) === JSON.stringify(expected.storageParameters) &&
    actual.method === expected.method &&
    actual.indnatts === expected.keys.length &&
    actual.indnkeyatts === expected.keys.length &&
    sameKeys &&
    canonicalIndexPredicate(actual.predicate, enumTypes) ===
      canonicalIndexPredicate(expected.predicate, enumTypes) &&
    actual.valid === true && actual.ready === true && actual.live === true,
  `${label} catalog definition/uniqueness/predicate/columns/readiness mismatch`);
}

export function assertCatalogParity(actual, expected, label = "Staging migration") {
  const tablesByName = new Map(actual.tables.map((table) => [table.name, table]));
  const enumNames = expected.enums.map((entry) => entry.name);
  for (const expectedTable of expected.tables) {
    const table = tablesByName.get(expectedTable.name);
    assert(table && table.kind === "r",
      `${label} missing approved table ${expectedTable.name}`);
    const actualColumns = table.columns.map((column) => ({
      name: column.name,
      type: normalizeType(column.type),
      notNull: column.notNull,
      default: canonicalDefault(column.default, column.type),
    }));
    const expectedColumns = expectedTable.columns.map((column) => ({
      name: column.name,
      type: normalizeType(column.type),
      notNull: column.notNull,
      default: canonicalDefault(column.default, column.type),
    }));
    assert(JSON.stringify(actualColumns) === JSON.stringify(expectedColumns),
      `${label} column type/nullability/default mismatch on ${expectedTable.name}`);
    compareConstraint(table.constraints, expectedTable.constraints,
      `${label} ${expectedTable.name}`, enumNames);
  }

  for (const expectedColumn of expected.alteredColumns) {
    const table = tablesByName.get(expectedColumn.table);
    const column = table?.columns.find((entry) => entry.name === expectedColumn.name);
    assert(column &&
      normalizeType(column.type) === normalizeType(expectedColumn.type) &&
      column.notNull === expectedColumn.notNull &&
      canonicalDefault(column.default, column.type) ===
        canonicalDefault(expectedColumn.default, expectedColumn.type),
    `${label} altered column definition mismatch on ${expectedColumn.table}.${expectedColumn.name}`);
  }

  for (const expectedConstraint of expected.constraints) {
    const table = tablesByName.get(expectedConstraint.table);
    const actualConstraint = table?.constraints.find((entry) => entry.name === expectedConstraint.name);
    assert(actualConstraint &&
      JSON.stringify(constraintSignature(actualConstraint, enumNames)) ===
        JSON.stringify(constraintSignature({
          ...expectedConstraint,
          validated: true,
          deferrable: false,
          deferred: false,
        }, enumNames)),
    `${label} constraint/FK definition mismatch on ${expectedConstraint.table}.${expectedConstraint.name}`);
  }

  const enums = new Map(actual.enums.map((entry) => [entry.name, entry.labels]));
  const actualEnumNames = actual.enums.map((entry) => entry.name).sort();
  const expectedEnumNames = expected.enums.map((entry) => entry.name).sort();
  assert(JSON.stringify(actualEnumNames) === JSON.stringify(expectedEnumNames),
    `${label} has missing or unexpected enum types in public`);
  for (const expectedEnum of expected.enums) {
    assert(JSON.stringify(enums.get(expectedEnum.name)) === JSON.stringify(expectedEnum.labels),
      `${label} enum label/order mismatch on ${expectedEnum.name}`);
  }

  const indexes = new Map(actual.indexes.map((entry) => [entry.name, entry]));
  const actualIndexNames = actual.indexes.map((entry) => entry.name).sort();
  const expectedIndexNames = expected.indexes.map((entry) => entry.name).sort();
  assert(JSON.stringify(actualIndexNames) === JSON.stringify(expectedIndexNames),
    `${label} has missing or unexpected indexes on the approved tables`);
  for (const expectedIndex of expected.indexes) {
    assertIndexCatalogParity(indexes.get(expectedIndex.name), expectedIndex,
      `${label} index ${expectedIndex.name}`, enumNames);
  }

  const functions = new Map(actual.functions.map((entry) => [entry.name, entry]));
  for (const expectedFunction of expected.functions) {
    const fn = functions.get(expectedFunction.name);
    const functionMatches = actual.functions.filter((entry) => entry.name === expectedFunction.name).length === 1 &&
      fn && fn.arguments === expectedFunction.arguments &&
      normalizeType(fn.returns) === expectedFunction.returns &&
      fn.language === expectedFunction.language &&
      fn.source.trim() === expectedFunction.source.trim() &&
      fn.strict === expectedFunction.strict &&
      (fn.security_definer ?? fn.securityDefiner) === expectedFunction.securityDefiner &&
      fn.volatility === expectedFunction.volatility &&
      fn.parallel === expectedFunction.parallel &&
      fn.leakproof === expectedFunction.leakproof &&
      fn.returns_set === expectedFunction.returnsSet &&
      JSON.stringify(fn.config) === JSON.stringify(expectedFunction.config);
    assert(functionMatches,
      `${label} function body/signature/security mismatch on ${expectedFunction.name}`);
  }

  const triggers = new Map(actual.triggers.map((entry) => [entry.name, entry]));
  const actualTriggerNames = actual.triggers.map((entry) => entry.name).sort();
  const expectedTriggerNames = expected.triggers.map((entry) => entry.name).sort();
  assert(JSON.stringify(actualTriggerNames) === JSON.stringify(expectedTriggerNames),
    `${label} has missing or unexpected triggers on the approved tables`);
  for (const expectedTrigger of expected.triggers) {
    const trigger = triggers.get(expectedTrigger.name);
    assert(actual.triggers.filter((entry) => entry.name === expectedTrigger.name).length === 1 &&
      trigger && trigger.table === expectedTrigger.table &&
      trigger.function === expectedTrigger.function &&
      trigger.timing === expectedTrigger.timing &&
      JSON.stringify(trigger.events) === JSON.stringify(expectedTrigger.events) &&
      trigger.level === expectedTrigger.level &&
      trigger.enabled === expectedTrigger.enabled,
    `${label} trigger attachment/event/enabled-state mismatch on ${expectedTrigger.name}`);
  }
  return true;
}

export function mergeExpectedCatalog(models) {
  const merged = {
    tables: [],
    alteredColumns: [],
    constraints: [],
    enums: [],
    indexes: [],
    functions: [],
    triggers: [],
  };
  const tableMap = new Map();
  const maps = ["enums", "indexes", "functions", "triggers"];
  for (const model of models) {
    for (const table of model.tables) {
      const existing = tableMap.get(table.name);
      if (!existing) {
        const copy = structuredClone(table);
        tableMap.set(table.name, copy);
        merged.tables.push(copy);
      } else {
        for (const column of table.columns) {
          const previous = existing.columns.find((item) => item.name === column.name);
          if (previous) {
            assert(JSON.stringify(previous) === JSON.stringify(column),
              `Conflicting approved column definitions for ${table.name}.${column.name}`);
          } else existing.columns.push(structuredClone(column));
        }
        existing.constraints.push(...structuredClone(table.constraints)
          .filter((constraint) => !existing.constraints.some((item) => item.name === constraint.name)));
      }
    }
    for (const alteredColumn of model.alteredColumns) {
      const table = tableMap.get(alteredColumn.table);
      if (table) {
        const previous = table.columns.find((item) => item.name === alteredColumn.name);
        if (previous) {
          assert(JSON.stringify(previous) === JSON.stringify(alteredColumn),
            `Conflicting approved altered column ${alteredColumn.table}.${alteredColumn.name}`);
        } else table.columns.push(structuredClone(alteredColumn));
      }
      merged.alteredColumns.push(structuredClone(alteredColumn));
    }
    for (const constraint of model.constraints) {
      merged.constraints.push(structuredClone(constraint));
      const table = tableMap.get(constraint.table);
      if (table && !table.constraints.some((entry) => entry.name === constraint.name)) {
        table.constraints.push({
          name: constraint.name,
          type: constraint.type,
          definition: constraint.definition,
        });
      }
    }
    for (const key of maps) {
      for (const item of model[key]) {
        const previous = merged[key].find((entry) => entry.name === item.name);
        if (previous) {
          assert(JSON.stringify(previous) === JSON.stringify(item),
            `Conflicting approved ${key} definition for ${item.name}`);
        } else merged[key].push(structuredClone(item));
      }
    }
  }
  for (const table of merged.tables) {
    for (const constraint of table.constraints) {
      if (!["p", "u"].includes(constraint.type) || !constraint.keyColumns?.length) continue;
      if (merged.indexes.some((index) => index.name === constraint.name)) continue;
      merged.indexes.push({
        name: constraint.name,
        table: table.name,
        unique: true,
        primary: constraint.type === "p",
        method: "btree",
        keys: constraint.keyColumns.map((name) => ({
          name,
          descending: false,
          nullsFirst: false,
        })),
        predicate: null,
        immediate: true,
        nullsNotDistinct: false,
        exclusion: false,
        storageParameters: [],
      });
    }
  }
  return merged;
}

export function expectedCatalogForPrefix(plan, executionOrder) {
  return mergeExpectedCatalog(
    plan.entries.slice(0, executionOrder + 1).map((entry) => entry.catalog),
  );
}

export function catalogInventory(catalog) {
  return {
    tables: [...new Set([
      ...catalog.tables.map((table) => table.name),
      ...catalog.alteredColumns.map((column) => column.table),
      ...catalog.constraints.map((constraint) => constraint.table),
    ])],
    enums: catalog.enums.map((entry) => entry.name),
    indexes: catalog.indexes.map((entry) => entry.name),
    functions: catalog.functions.map((entry) => entry.name),
    triggers: catalog.triggers.map((entry) => entry.name),
    alteredColumns: catalog.alteredColumns.map((column) => `${column.table}.${column.name}`),
  };
}

export function validateCatalogManifest(catalog, inventory, label) {
  const parsed = {
    tables: catalog.tables.map((item) => item.name),
    enums: catalog.enums.map((item) => item.name),
    indexes: catalog.indexes.map((item) => item.name),
    functions: catalog.functions.map((item) => item.name),
    triggers: catalog.triggers.map((item) => item.name),
    alteredColumns: catalog.alteredColumns.map((item) => `${item.table}.${item.name}`),
  };
  for (const key of Object.keys(parsed)) {
    assert(JSON.stringify([...parsed[key]].sort()) === JSON.stringify([...inventory[key]].sort()),
      `${label} catalog SQL declarations disagree with the pinned manifest (${key})`);
  }
}