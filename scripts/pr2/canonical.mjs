const whitespace = new Set([' ', '\t', '\r', '\n']);

function fail(message) {
  throw new TypeError(`INVALID_JSON: ${message}`);
}

function assertNfc(value, label = 'string') {
  if (value.normalize('NFC') !== value) fail(`${label} is not NFC`);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function parseStrictJson(text) {
  if (typeof text !== 'string') fail('input must be a string');
  let index = 0;

  const skip = () => {
    while (whitespace.has(text[index])) index += 1;
  };

  const parseString = () => {
    if (text[index] !== '"') fail(`expected string at ${index}`);
    const start = index;
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        let value;
        try {
          value = JSON.parse(text.slice(start, index));
        } catch {
          fail(`malformed string at ${start}`);
        }
        assertNfc(value);
        return value;
      }
      if (char === '\\') {
        index += 1;
        if (index >= text.length) fail(`unterminated escape at ${start}`);
        if (text[index] === 'u') {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`bad unicode escape at ${index}`);
          index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[index])) fail(`bad escape at ${index}`);
      } else {
        if (char.charCodeAt(0) < 0x20) fail(`control character at ${index}`);
      }
      index += 1;
    }
    fail(`unterminated string at ${start}`);
  };

  const parseNumber = () => {
    const tail = text.slice(index);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(tail);
    if (!match) fail(`bad number at ${index}`);
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(`integer out of contract at ${index}`);
    return value;
  };

  const parseValue = () => {
    skip();
    const char = text[index];
    if (char === '"') return parseString();
    if (char === '{') {
      index += 1;
      skip();
      const value = {};
      const seen = new Set();
      if (text[index] === '}') {
        index += 1;
        return value;
      }
      while (index < text.length) {
        skip();
        const key = parseString();
        if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        seen.add(key);
        skip();
        if (text[index] !== ':') fail(`expected colon at ${index}`);
        index += 1;
        value[key] = parseValue();
        skip();
        if (text[index] === '}') {
          index += 1;
          return value;
        }
        if (text[index] !== ',') fail(`expected comma at ${index}`);
        index += 1;
      }
      fail('unterminated object');
    }
    if (char === '[') {
      index += 1;
      skip();
      const value = [];
      if (text[index] === ']') {
        index += 1;
        return value;
      }
      while (index < text.length) {
        value.push(parseValue());
        skip();
        if (text[index] === ']') {
          index += 1;
          return value;
        }
        if (text[index] !== ',') fail(`expected comma at ${index}`);
        index += 1;
      }
      fail('unterminated array');
    }
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    if (char === '-' || (char >= '0' && char <= '9')) return parseNumber();
    fail(`unexpected token at ${index}`);
  };

  const result = parseValue();
  skip();
  if (index !== text.length) fail(`trailing content at ${index}`);
  return result;
}

function serialize(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('only safe non-negative-zero integers are allowed');
    return String(value);
  }
  if (typeof value === 'string') {
    assertNfc(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) assertNfc(key, 'object key');
    return `{${keys.map(key => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
  }
  fail('unsupported value');
}

export function canonicalJson(value) {
  return `${serialize(value)}\n`;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function assertClosedObject(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expected = [...keys].sort(compareUtf8);
  const actual = Object.keys(value).sort(compareUtf8);
  if (expected.length !== actual.length || expected.some((key, i) => key !== actual[i])) {
    throw new TypeError(`${label} keys must be exactly ${expected.join(',')}`);
  }
  return value;
}
