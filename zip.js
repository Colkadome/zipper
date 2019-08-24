(function() {

  /**
   * zipper.js
   *
   * Main Zipper class.
   */
  function Zipper() {
    this._entries = [];
  }

  /**
   * Adds an entry to the zip archive.
   *
   * @arg {String} path - the path of the entry.
   * @arg {...} data - the file data.
   * @returns {Number} number of resulting files in the archive.
   */
  Zipper.prototype.addEntry = function (path, data) {

    path = String(path)       // Make sure 'path' is a string.
      .replace(/[\x00-\x19\x7F]/, '')  // Remove non-printable characters.
      .replace(/\/+/g, '/')   // Remove double '/' characters (zip ignores these).
      .trim()                 // Remove any outer whitespace.
      .replace(/^\//, '')     // Remove starting '/' (zip ignores absolute paths).
      .replace(/\/$/, '');     // Remove ending '/' (or else zip thinks this is a folder).

    if (path.length === 0) {
      throw new Error('path is empty');
    }

    // Make sure path doesn't exceed character limit.
    // The filename size in the zip headers has a 2-byte limit.
    if (path.length > 0xFFFF) {
      throw new Error('path exceeds maximum of 65535 characters.');
    }

    // Using the validated path, check if there are any
    // existing enties with the same path.
    if (this.hasFile(path)) {
      throw new Error('path already exists.');
    }

    // Check if any parent folders in the archive
    // are the same as 'path'.
    if (this.hasFolder(path)) {
      throw new Error('path collides with an existing folder.');
    }

    // Check for file collision with parent folders.
    var parents = getFolderPathsFromPath(path);
    for (var i = 0; i < parents.length; i++) {
      if (this.hasFile(parents[i])) {
        throw new Error('path parent folder collides with an existing file.');
      }
    }

    // Make sure that 'data' can be somehow transformed
    // into a Uint8Array. Generating the zip headers is done
    // in terms of bytes (checksum, length, etc), so it helps to
    // have the data represented as a Uint8Array.
    if (data instanceof Uint8Array) {
      // Do nothing.
    } else if (typeof data === 'string') {
      data = stringToBytes(data);
    } else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      data = new Uint8Array(data);
    } else if (Array.isArray(data)) {
      data = new Uint8Array(data);
    } else if (!data) {
      data = new Uint8Array();
    } else {
      throw new Error('Data must be one of the following: [String, ArrayBuffer, Uint8Array, Array]');
    }

    // Make sure data doesn't exceed maximum size.
    if (data.length > 0xFFFFFFFF) {
      throw new Error('data exceeds maximum size of 4294967295 bytes');
    }

    return this._entries.push({ path: path, data: data });
  };

  /**
   * Gets the existing files and packs them into zip chunks.
   * @returns {Array} array of Uint8Array chunks.
   */
  Zipper.prototype._pack = function (options) {
    options = options || {};

    var comment = validateComment(options.comment || '');

    var parts = [];
    var cd = [];
    var offset = 0;
    var cdSize = 0;

    for (var i = 0; i < this._entries.length; i++) {
      var path = this._entries[i].path;
      var data = this._entries[i].data;

      var checksum = bytesToCrc32(data);

      // Local header.

      var localHeader = getLocalFileHeader({
        checksum: checksum,
        size: data.length,
        path: path
      });
      parts.push(localHeader);
      parts.push(data);

      // CD header.

      var cdHeader = getCentralDirectoryHeader({
        checksum: checksum,
        size: data.length,
        path: path,
        offset: offset,
      });
      cd.push(cdHeader);

      offset += localHeader.length + data.length;
      cdSize += cdHeader.length;
    }

    // EOCD.

    var eocd = getEOCDHeader({
      entries: cd.length,
      cdSize: cdSize,
      cdOffset: offset,
      comment: comment,
    });

    return parts.concat(cd, eocd);
  };

  /**
   * Returns true if 'path' exists as a folder in the current files.
   * @returns {Boolean}
   */
  Zipper.prototype.hasFolder = function (path) {
    return this.getFolder(path) !== undefined;
  };

  /**
   * Returns an entry that contains a folder.
   * @returns {Object}
   */
  Zipper.prototype.getFolder = function (path) {
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i].path.startsWith(path + '/')) {
        return this._entries[i];
      }
    }
  };

  /**
   * Returns array of all existing folder paths.
   * @returns {Array}
   */
  Zipper.prototype.getFolders = function () {

    var names = {};

    this._entries.forEach(function (file) {
      getFolderPathsFromPath(file.path).forEach(function (path) {
        names[path] = 1;
      });
    });

    return Object.keys(names);
  };

  /**
   * Returns true if entries contain file path.
   * @returns {Boolean}
   */
  Zipper.prototype.hasFile = function (path) {
    return this.getFile(path) !== undefined;
  };

  /**
   * Returns entry of matching file path.
   * @returns {Object}
   */
  Zipper.prototype.getFile = function (path) {
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i].path === path) {
        return this._entries[i];
      }
    }
  };

  /**
   * Returns array of current file paths.
   * @returns {Array}
   */
  Zipper.prototype.getFiles = function () {
    return this._entries.map(function (file) { return file.path; });
  };

  /**
   * Returns number of entries.
   * @returns {Number}
   */
  Zipper.prototype.count = function () {
    return this._entries.length;
  };

  /**
   * Packs and returns zip data as a Uint8Array.
   * @returns {Uint8Array}
   */
  Zipper.prototype.toUint8Array = function (options) {
    return concatArrays(this._pack(options));
  };

  /**
   * Packs and returns zip data as a Blob.
   * @returns {Blob}
   */
  Zipper.prototype.toBlob = function (options) {
    return new Blob(this._pack(options), { type: 'application/zip' });
  };

  /**
   * Generates a Local File Header for a Zip file.
   * @arg {Object} options.
   * @returns {Uint8Array} local file header.
   */
  function getLocalFileHeader (options) {
    options = options || {};
    var checksum    = options.checksum || 0;
    var size        = options.size || 0;
    var path        = options.path || 'untitled';
    var date        = options.date;
    var extra       = '';

    return concatArrays(

      // 4 - Signature (unchanging).
      [0x50, 0x4b, 0x03, 0x04],

      // 2 - Version needed for extraction (10 = 1.0).
      [0x0a, 0x00],
      
      // 2 - Flags (none set).
      [0, 0],

      // 2 - Compression method (none).
      [0, 0],

      // 4 - File modification time/date.
      dateToBytes(date),

      // 4 - CRC-32 checksum of file data.
      numberToBytes(checksum, 4),

      // 4 - Compressed size.
      numberToBytes(size, 4),

      // 4 - Uncompressed size.
      numberToBytes(size, 4),

      // 2 - Filename length.
      numberToBytes(path.length, 2),

      // 2 - Extra field length.
      numberToBytes(extra.length, 2),

      // N - Filename.
      stringToBytes(path),

      // N - Extra field.
      stringToBytes(extra)
    );
  }

  /**
   * Generates a Central directory header for a Zip file.
   * @arg @arg {Object} options.
   * @returns {Uint8Array} Central directory header.
   */
  function getCentralDirectoryHeader (options) {
    options = options || {};
    var date        = options.date;
    var checksum    = options.checksum || 0;
    var size        = options.size || 0;
    var path        = options.path || 'untitled';
    var extra       = '';
    var comment     = validateComment(options.comment || '');
    var offset      = options.offset || 0;
    var isFolder    = options.isFolder || false;

    return concatArrays(

      // 4 - Signature.
      [0x50, 0x4b, 0x01, 0x02],

      // 2 - What was this zip file made with? Upper = 30, or 3.0 (VERSION), lower = 3 (UNIX).
      [0x1e, 0x03],

      // 2 - Version needed for extraction (10 = 1.0).
      [0x0a, 0x00],

      // 2 - Flags (none set).
      [0, 0],

      // 2 - Compression method (0 = none).
      [0, 0],

      // 4 - File modification time/date.
      dateToBytes(date),

      // 4 - CRC-32 checksum of file data.
      numberToBytes(checksum, 4),

      // 4 - Compressed size.
      numberToBytes(size, 4),

      // 4 - Uncompressed size.
      numberToBytes(size, 4),

      // 2 - Filename length.
      numberToBytes(path.length, 2),

      // 2 - Extra field length (21).
      numberToBytes(extra.length, 2),

      // 2 - Length of optional file comments.
      numberToBytes(comment.length, 2),

      // 2 - Number of disk this file is on (always 0).
      [0, 0],

      // 2 - Internal file properties. (1st bit = hint of ASCII/text text file).
      [0, 0],

      // 4 - External file properties (host specific).
      // First bit marks folder. The last 2 bytes seem to control file permissions.
      [0x00, 0x00, 0xa4, 0x81],

      // 4 - Offset of local header from start of first disk.
      numberToBytes(offset, 4),

      // N - Filename bytes.
      stringToBytes(path),

      // N - Extra field bytes.
      stringToBytes(extra),

      // N - Comment bytes.
      stringToBytes(comment)
    );
  }

  /**
   * Generates an End Of Central Directory header for a Zip file.
   * @arg {Object} options.
   * @returns {Uint8Array} End Of Central Directory header.
   */
  function getEOCDHeader (options) {
    options = options || {};
    var entries     = options.entries || 0;
    var cdSize      = options.cdSize || 0;
    var cdOffset    = options.cdOffset || 0;
    var comment     = options.comment || '';

    return concatArrays(

      // 4 - Signature. Every EOCD header has the same 4 bytes.
      [0x50, 0x4b, 0x05, 0x06],

      // 2 - Disk number. If a zip file is distributed across multiple disks,
      // this would be the number of the disk that contains this EOCD.
      // Not relevant here though, so set to 0.
      [0, 0],

      // 2 - Disk number of Central Directory.
      [0, 0],

      // 2 - Number of central directory entries on this disk.
      // This is just the number of files.
      numberToBytes(entries, 2),

      // 2 - Total number of central directory entries.
      // Just the same as the number of entries.
      numberToBytes(entries, 2),

      // 4 - Size of Central Directory.
      numberToBytes(cdSize, 4),

      // 4 - Offset of first byte in the Central Directory.
      numberToBytes(cdOffset, 4),

      // 2 - Length of optional supplied comment.
      numberToBytes(comment.length, 2),

      // N - Optional comment.
      stringToBytes(comment)
    );
  }

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
   * Checks if a file comment, or EOCD comment, is valid.
   * Throws an error if file comment is invalid.
   *
   * @arg {Any} data - data to try and convert.
   * @returns {Uint8Array} bytes.
   */
  function validateComment (str) {

    if (str == null) {
      return '';
    }

    str = String(str);

    if (str.length > 0xFFFF) {
      throw new Error('Comment exceeds maximum of 65535 characters.');
    }

    return str;
  }

  /**
   * Converts a Date to 4 bytes to store in Zip file.
   * Zip stores dates with the following format:
   *
   * 00000000 00000000    00000000 00000000
   * \---/\-- --/\---/    \-----/\ --/\---/
   *   |    |      |          |     |    |
   *   |    |      Seconds/2. |     |    Day of month (1 - 31).
   *   |    Minutes.          |     Month of year (1 - 12).
   *   Hours.                 Year(s) since 1980.
   *
   * @arg {Date} date - date to convert.
   * @returns {Uint8Array} array of 4 bytes.
   */
  function dateToBytes (date) {
    date = date !== undefined ? new Date(date) : new Date();

    var h = date.getHours();
    var m = date.getMinutes();
    var s = date.getSeconds();

    var year = date.getFullYear() - 1980;
    var month = date.getMonth() + 1;
    var day = date.getDate();

    return new Uint8Array([
      (h << 3) + (m >> 3),
      ((m << 5) & 0xFF) + (s >> 1),
      (year << 1) + (month >> 3),
      ((month << 5) & 0xFF) + day
    ]);
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
   * Function to get folder names from a file path.
   * Ie. "my/file/here.txt" will return ["my", "my/file"]
   * @arg {String} file path.
   * @returns {Array} array of folder names.
   */
  function getFolderPathsFromPath (path) {

    var arr = path ? path.split('/') : [];

    var names = [];
    for (var i = 1; i < arr.length; i++) {
      names.push(arr.slice(0, i).join('/'));
    }

    return names;
  }

  /**
   * Calculates the checksum of an array of bytes, with crc-32.
   *
   * Based on:
   * https://stackoverflow.com/questions/18638900/javascript-crc32
   *
   * @arg {Array} array of bytes.
   * @returns {Number} crc32 result.
   */
  function bytesToCrc32 (bytes) {

    var CRC_TABLE = [
      0x00000000,0x77073096,0xee0e612c,0x990951ba,0x076dc419,0x706af48f,
      0xe963a535,0x9e6495a3,0x0edb8832,0x79dcb8a4,0xe0d5e91e,0x97d2d988,
      0x09b64c2b,0x7eb17cbd,0xe7b82d07,0x90bf1d91,0x1db71064,0x6ab020f2,
      0xf3b97148,0x84be41de,0x1adad47d,0x6ddde4eb,0xf4d4b551,0x83d385c7,
      0x136c9856,0x646ba8c0,0xfd62f97a,0x8a65c9ec,0x14015c4f,0x63066cd9,
      0xfa0f3d63,0x8d080df5,0x3b6e20c8,0x4c69105e,0xd56041e4,0xa2677172,
      0x3c03e4d1,0x4b04d447,0xd20d85fd,0xa50ab56b,0x35b5a8fa,0x42b2986c,
      0xdbbbc9d6,0xacbcf940,0x32d86ce3,0x45df5c75,0xdcd60dcf,0xabd13d59,
      0x26d930ac,0x51de003a,0xc8d75180,0xbfd06116,0x21b4f4b5,0x56b3c423,
      0xcfba9599,0xb8bda50f,0x2802b89e,0x5f058808,0xc60cd9b2,0xb10be924,
      0x2f6f7c87,0x58684c11,0xc1611dab,0xb6662d3d,0x76dc4190,0x01db7106,
      0x98d220bc,0xefd5102a,0x71b18589,0x06b6b51f,0x9fbfe4a5,0xe8b8d433,
      0x7807c9a2,0x0f00f934,0x9609a88e,0xe10e9818,0x7f6a0dbb,0x086d3d2d,
      0x91646c97,0xe6635c01,0x6b6b51f4,0x1c6c6162,0x856530d8,0xf262004e,
      0x6c0695ed,0x1b01a57b,0x8208f4c1,0xf50fc457,0x65b0d9c6,0x12b7e950,
      0x8bbeb8ea,0xfcb9887c,0x62dd1ddf,0x15da2d49,0x8cd37cf3,0xfbd44c65,
      0x4db26158,0x3ab551ce,0xa3bc0074,0xd4bb30e2,0x4adfa541,0x3dd895d7,
      0xa4d1c46d,0xd3d6f4fb,0x4369e96a,0x346ed9fc,0xad678846,0xda60b8d0,
      0x44042d73,0x33031de5,0xaa0a4c5f,0xdd0d7cc9,0x5005713c,0x270241aa,
      0xbe0b1010,0xc90c2086,0x5768b525,0x206f85b3,0xb966d409,0xce61e49f,
      0x5edef90e,0x29d9c998,0xb0d09822,0xc7d7a8b4,0x59b33d17,0x2eb40d81,
      0xb7bd5c3b,0xc0ba6cad,0xedb88320,0x9abfb3b6,0x03b6e20c,0x74b1d29a,
      0xead54739,0x9dd277af,0x04db2615,0x73dc1683,0xe3630b12,0x94643b84,
      0x0d6d6a3e,0x7a6a5aa8,0xe40ecf0b,0x9309ff9d,0x0a00ae27,0x7d079eb1,
      0xf00f9344,0x8708a3d2,0x1e01f268,0x6906c2fe,0xf762575d,0x806567cb,
      0x196c3671,0x6e6b06e7,0xfed41b76,0x89d32be0,0x10da7a5a,0x67dd4acc,
      0xf9b9df6f,0x8ebeeff9,0x17b7be43,0x60b08ed5,0xd6d6a3e8,0xa1d1937e,
      0x38d8c2c4,0x4fdff252,0xd1bb67f1,0xa6bc5767,0x3fb506dd,0x48b2364b,
      0xd80d2bda,0xaf0a1b4c,0x36034af6,0x41047a60,0xdf60efc3,0xa867df55,
      0x316e8eef,0x4669be79,0xcb61b38c,0xbc66831a,0x256fd2a0,0x5268e236,
      0xcc0c7795,0xbb0b4703,0x220216b9,0x5505262f,0xc5ba3bbe,0xb2bd0b28,
      0x2bb45a92,0x5cb36a04,0xc2d7ffa7,0xb5d0cf31,0x2cd99e8b,0x5bdeae1d,
      0x9b64c2b0,0xec63f226,0x756aa39c,0x026d930a,0x9c0906a9,0xeb0e363f,
      0x72076785,0x05005713,0x95bf4a82,0xe2b87a14,0x7bb12bae,0x0cb61b38,
      0x92d28e9b,0xe5d5be0d,0x7cdcefb7,0x0bdbdf21,0x86d3d2d4,0xf1d4e242,
      0x68ddb3f8,0x1fda836e,0x81be16cd,0xf6b9265b,0x6fb077e1,0x18b74777,
      0x88085ae6,0xff0f6a70,0x66063bca,0x11010b5c,0x8f659eff,0xf862ae69,
      0x616bffd3,0x166ccf45,0xa00ae278,0xd70dd2ee,0x4e048354,0x3903b3c2,
      0xa7672661,0xd06016f7,0x4969474d,0x3e6e77db,0xaed16a4a,0xd9d65adc,
      0x40df0b66,0x37d83bf0,0xa9bcae53,0xdebb9ec5,0x47b2cf7f,0x30b5ffe9,
      0xbdbdf21c,0xcabac28a,0x53b39330,0x24b4a3a6,0xbad03605,0xcdd70693,
      0x54de5729,0x23d967bf,0xb3667a2e,0xc4614ab8,0x5d681b02,0x2a6f2b94,
      0xb40bbe37,0xc30c8ea1,0x5a05df1b,0x2d02ef8d
    ];

    var crc = -1;

    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }

    return (crc ^ (-1)) >>> 0;
  };

  /**
   * Export Zipper class.
   */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Zipper;
  } else if (typeof window !== 'undefined') {
    window.Zipper = Zipper;
  }

}());