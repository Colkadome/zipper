/*
  tar.js
*/

/**
 * Converts a string into an array of bytes.
 * Byte codes will be wrapped if they exceed the 0-255 range.
 * @arg {String} string to convery.
 * @arg {len} optional length for the output. Pads with 0s.
 * @returns {Uint8Array} with same length as string.
 */
function stringToBytes (str, len) {
  len = len === undefined ? str.length : len;

  var arr = new Uint8Array(len);

  for (var i = 0; i < len; i++) {
    arr[i] = str.charCodeAt(i);
  }

  return arr;
};

/**
 * Converts a number to an array of bytes,
 * where the least significant byte is always the first byte
 * (how Zip stores numbers).
 * 
 * Output is padded with 0s to reach 'len' length.
 *
 * @arg {Number} n - number to convert.
 * @arg {Number} len - desired output array length.
 * @returns {Uint8Array} array of length 'len'.
 */
function numberToBytes (n, len) {

  var bytes = new Uint8Array(len);
  var i = 0;

  while (i < len) {
    bytes[i] = n & 0xFF;
    n >>= 8;
    i += 1;
  }

  return bytes;
};

/**
 * Concatenates multiple Arrays/Uint8Arrays into one Uint8Array.
 * Useful when constructing the zip headers.
 * @arg {...Arrays}
 * @returns {Uint8Array}
 */
function concatArrays() {
  var args = arguments;

  var len = 0;
  for (var i = 0; i < args.length; i++) {
    len += args[i].length;
  }

  var result = new Uint8Array(len);
  var offset = 0;
  for (var i = 0; i < args.length; i++) {
    result.set(args[i], offset);
    offset += args[i].length;
  }

  return result;
}

/**
 * Gets sum of all bytes in arrays.
 * @arg {...Arrays}
 * @returns {Number} sum of bytes.
 */
function sumOfArrays() {
  var args = arguments;

  var sum = 0;
  for (var i = 0; i < args.length; i++) {
    var arr = args[i];
    for (var j = 0; j < arr.length; j++) {
      sum += arr[j];
    }
  }

  return sum;
}

/**
 * Generates a header for a TAR entry.
 * @arg {Object} options.
 * @returns {Uint8Array} TAR header data.
 */
function getTarHeader (options) {
  options = options || {};

  // Get default fields.
  var path        = options.path || '';
  var size        = options.size || 0;
  var date        = options.date !== undefined ? new Date(options.date) : new Date();

  // Get field bytes.
  var pathBytes           = stringToBytes(path, 100);
  var modeBytes           = stringToBytes('000644 ', 8);
  var ownerBytes          = stringToBytes('000000 ', 8);
  var groupBytes          = stringToBytes('000000 ', 8);

  var sizeStr             = '00000000000' + size + ' ';
  sizeStr                 = sizeStr.substr(sizeStr.length - 12);
  var sizeBytes           = stringToBytes(sizeStr, 12);

  var dateStr             = '00000000000' + Math.floor(Number(date) * 0.001).toString(8) + ' ';
  dateStr                 = dateStr.substr(dateStr.length - 12)
  var dateBytes           = stringToBytes(dateStr, 12);

  var linkBytes           = stringToBytes('0');
  var linkPathBytes       = stringToBytes('', 100);

  // Get sum of all bytes for checksum.

  var sum = sumOfArrays(
    pathBytes,
    modeBytes,
    ownerBytes,
    groupBytes,
    sizeBytes,
    dateBytes,
    [32, 32, 32, 32, 32, 32, 32, 32],  // 8 spaces.
    linkBytes,
    linkPathBytes
  );

  var checksumStr = '000000' + sum.toString(8);
  checksumStr = checksumStr.substr(checksumStr.length - 6);
  var checksumBytes = concatArrays(stringToBytes(checksumStr), [0, 32]);

  // Construct header.
  return concatArrays(
    pathBytes,
    modeBytes,
    ownerBytes,
    groupBytes,
    sizeBytes,
    dateBytes,
    checksumBytes,
    linkBytes,
    linkPathBytes,
    new Uint8Array(255)
  );
}

/**
 * Main Zipper class.
 */

class Zipper {

  constructor() {
    this._files = [];
  }

  /**
   * Adds an entry to the zip archive.
   * @returns {Number} number of resulting files in the archive.
   */
  addFile(path, data) {
    return this._files.push({
      path: path,
      data: data,
    });
  }

  _pack(options) {
    options = options || {};

    var parts = [];

    for (var i = 0; i < this._files.length; i++) {
      var path = this._files[i].path;
      var data = this._files[i].data;

      var header = getTarHeader({
        path: path,
        size: data.length,
      });

      parts.push(header);
      parts.push(data);

      var pad = 512 - (data.length % 512);
      if (pad > 0) {
        parts.push(new Uint8Array(pad));
      }
    }

    return parts;
  }

  toUint8Array(options) {
    return concatArrays(this._packTar(options));
  }

  toBlob(options) {
    return new Blob(this._packTar(options), { type: 'application/tar' });
  }
}
