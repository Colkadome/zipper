/*
  Zipper class.
*/

class Zipper {

  constructor() {

    // File entries, starting from offset 0.
    // Each file added will create 2 entries to _parts: the header, and the data.
    this._parts = [];

    // Central directory, starting from the end of parts.
    // Each file added will create 1 entry to _cd.
    this._cd = [];

  }

  /*
    Internal functions.
  */

  /**
  * Adds an entry to the zip archive.
  * Returns: Number of files in the zip archive, as a result of this call.
  */
  _addEntry(filename, data, isFolder) {

    // Filename must be a string.

    if (typeof filename !== 'string') {
      console.warn(`Zipper (${this._cd.length}): Filename must be a string. Skipping.`);
      return this._cd.length;
    }

    // Reduce multiple '/' characters, and remove start/end '/' characters.
    // This is done by unzip if detected, but this will save the warnings.

    filename = filename
      .replace(/\/+/g, '/')
      .replace(/^\//, '')
      .replace(/\/$/, '');

    // Check if theres anything left after trimming all the '/' characters.

    if (filename.length === 0) {
      console.warn(`Zipper (${this._cd.length}): Filename is required. Skipping.`);
      return this._cd.length;
    }

    // If a folder, make sure filename ends with '/', or else it won't be recognised as a folder.

    if (isFolder && !filename.endsWith('/')) {
      filename += '/';
    }

    // Make sure 'filename' doesn't exceed character limit.

    if (filename.length > 0xFF) {
      console.warn(`Zipper (${this._cd.length}): Filename length of ${filename.length} exceeds 255 characters. Skipping.`);
      return this._cd.length;
    }

    // Check if 'filename' is already in the archive.

    if (this.getNames().includes(filename)) {
      console.warn(`Zipper (${this._cd.length}): Archive already contains entry named "${filename}". Skipping.`);
      return this._cd.length;
    }

    // Convert 'data' to a Uint8Array.

    if (data instanceof Uint8Array) {
      // Do nothing.
    } else if (typeof data === 'string') {
      data = Zipper.stringToBytes(data);
    } else if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      data = new Uint8Array(data);
    } else if (Array.isArray(data)) {
      data = new Uint8Array(data);
    } else if (!data) {
      data = new Uint8Array();
    } else {
      console.warn(`Zipper (${this._cd.length}): File data must be one of the following: [String, ArrayBuffer, Uint8Array, Array]. Skipping.`);
      return this._cd.length;
    }

    // Make sure data doesn't exceed maximum size.

    if (data.length > 0xFFFFFFFF) {
      console.log(`Zipper (${this._cd.length}): File exceeds maximum size of 4294967295 bytes. Skipping.`);
      return this._cd.length;
    }

    // Other properties.

    const date = new Date();
    const checksum = Zipper.bytesToCrc32(data);
    const extraField = '';
    const offset = this._parts.reduce((total, part) => total + part.length, 0);
    const fileComment = '';

    /*
      --------------------
      Local file header and data.
      --------------------
    */

    const timeBytes = Zipper.timeToBytes(date);
    const dateBytes = Zipper.dateToBytes(date);
    const checksumBytes = Zipper.numberToBytes(checksum, 4);
    const sizeBytes = Zipper.numberToBytes(data.length, 4);
    const filenameLengthBytes = Zipper.numberToBytes(filename.length, 2);
    const extraFieldLengthBytes = Zipper.numberToBytes(extraField.length, 2);
    const filenameBytes = Zipper.stringToBytes(filename);
    const extraFieldBytes = Zipper.stringToBytes(extraField);

    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,     // 4 - Signature (unchanging).
      0x0a, 0x00,                 // 2 - Version needed for extraction (10 = 1.0).
      0x00, 0x00,                 // 2 - Flags (none).
      0x00, 0x00,                 // 2 - Compression method (none).
      ...timeBytes,               // 2 - File modification time.
      ...dateBytes,               // 2 - File modification date.
      ...checksumBytes,           // 4 - CRC-32 checksum.
      ...sizeBytes,               // 4 - Compressed size (69).
      ...sizeBytes,               // 4 - Uncompressed size (69).
      ...filenameLengthBytes,     // 2 - Filename length (5).
      ...extraFieldLengthBytes,   // 2 - Extra field length (21).
      ...filenameBytes,           // N - Filename.
      ...extraFieldBytes,         // N - Extra OS properties, such as more accurate timestamp (?).
    ]);

    /*
      --------------------
      Central directory header.
      --------------------
    */

    const diskStartBytes = Zipper.numberToBytes(0, 2);
    const offsetBytes = Zipper.numberToBytes(offset, 4);
    const externalBytes = isFolder ? [0x10, 0x00, 0xed, 0x41] : [0x00, 0x00, 0xa4, 0x81];
    const fileCommentBytes = Zipper.stringToBytes(fileComment);
    const fileCommentLengthBytes = Zipper.numberToBytes(fileCommentBytes.length, 2);

    const cdHeader = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,     // 4 - Signature (always this).
      0x1e, 0x03,                 // 2 - What was this zip file made with? Upper = 30, or 3.0 (VERSION), lower = 3 (UNIX).
      0x0a, 0x00,                 // 2 - Version needed for extraction (10 = 1.0).
      0x00, 0x00,                 // 2 - Flags (none).
      0x00, 0x00,                 // 2 - Compression method (0 = none).
      ...timeBytes,               // 2 - File modification time.
      ...dateBytes,               // 2 - File modification date.
      ...checksumBytes,           // 4 - CRC-32 checksum.
      ...sizeBytes,               // 4 - Compressed size (69).
      ...sizeBytes,               // 4 - Uncompressed size (69).
      ...filenameLengthBytes,     // 2 - Filename length (5).
      ...extraFieldLengthBytes,   // 2 - Extra field length (21).
      ...fileCommentLengthBytes,  // 2 - Length of optional file comments.
      ...diskStartBytes,          // 2 - Number of disk this file is on (always 0).
      0x00, 0x00,                 // 2 - Internal file properties. (1st bit = hint of ASCII/text text file)
      ...externalBytes,           // 4 - External file properties (host specific). First bit marks folder. The last 2 bytes seem to control file permissions.
      ...offsetBytes,             // 4 - Offset of local header from start of first disk.
      ...filenameBytes,           // N - Filename.
      ...extraFieldBytes,         // N - Extra field bytes.
      ...fileCommentBytes,        // N - Comment bytes.
    ]);

    // Store entry parts.

    this._parts.push(localHeader);
    this._parts.push(data);
    this._cd.push(cdHeader);

    // Return the number of total files so far.

    return this._cd.length;
  }

  _getEOCD(comment) {

    // Generates the "End Of Central Directory" for the end of the zip file.
    // This is run whenever the zip archive is finalised.

    if (!comment) {
      comment = '';
    } else if (typeof comment !== 'string') {
      comment = '';
    } else if (comment.length > 65535) {
      comment = comment.substr(0, 65535);
    }

    const numEntries = this._cd.length;
    const cdSize = this._cd.reduce((total, part) => total + part.length, 0);
    const cdOffset = this._parts.reduce((total, part) => total + part.length, 0);

    const numEntriesBytes = Zipper.numberToBytes(numEntries, 2);
    const cdSizeBytes = Zipper.numberToBytes(cdSize, 4);
    const cdOffsetBytes = Zipper.numberToBytes(cdOffset, 4);
    const commentLengthBytes = Zipper.numberToBytes(comment.length, 2);
    const commentBytes = Zipper.stringToBytes(comment);

    return new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, // 4 - Signature (always this).
      0x00, 0x00,             // 2 - Disk number of this disk (always 0).
      0x00, 0x00,             // 2 - Disk number of central directory (always 0).
      ...numEntriesBytes,     // 2 - Number of central directory enties on this disk.
      ...numEntriesBytes,     // 2 - Total number of central directory entries.
      ...cdSizeBytes,         // 4 - Size of central directory.
      ...cdOffsetBytes,       // 4 - Offset of start of CD, relative to disk where CD starts.
      ...commentLengthBytes,  // 2 - Length of optional comment.
      ...commentBytes,        // N - Optional comment.
    ]);
  }

  /*
    API functions.
  */

  addFolder(path) {

    // Folders are optional, as most unzippers will create folders where folder paths exist.
    // Folders are entered the same way as files, with the following key differences:
    // 1. filename ends with a '/'.
    // 2. "External file properties" value is different.

    return this._addEntry(path, null, true);
  }

  addFile(path, data) {

    return this._addEntry(path, data, false);
  }

  count() {
    return this._cd.length;
  }

  pop() {

    // Removes last entry from the archive.
    // Not sure why this would be useful.

    this._cd.pop();
    this._parts.pop();
    this._parts.pop();
    
    return this._cd.length;
  }

  getNames() {

    // Returns list of current entry names by decoding contents in 'this._cd'.

    return this._cd.map((bytes, i) => {

      const filenameLength = Zipper.bytesToNumber(bytes.subarray(28, 30));
      const filename = Zipper.bytesToString(bytes.subarray(46, 46 + filenameLength));

      return filename;

    });
  }

  toUint8Array(comment) {

    // Get array of all parts.

    const parts = this._parts.concat(this._cd, [this._getEOCD(comment)]);

    // Iterate through parts and add them to new Uint8Array.

    const size = parts.reduce((total, part) => total + part.length, 0);
    const arrayBuffer = new Uint8Array(size);
    let offset = 0;

    parts.forEach(part => {
      arrayBuffer.set(part, offset);
      offset += part.length;
    });

    return arrayBuffer;
  }

  toBlob(comment) {
    return new Blob(this._parts.concat(this._cd, [this._getEOCD(comment)]), { type: 'application/zip' });
  }
  
}

/*
  -------------------------
  Zipper General Helpers.
  -------------------------
*/

/**
 * CRC table used for 'bytesToCrc32'.
 */
Zipper._CRC_TABLE = [
  0,1996959894,3993919788,2567524794,124634137,1886057615,3915621685,2657392035,249268274,2044508324,
  3772115230,2547177864,162941995,2125561021,3887607047,2428444049,498536548,1789927666,4089016648,2227061214,
  450548861,1843258603,4107580753,2211677639,325883990,1684777152,4251122042,2321926636,335633487,1661365465,
  4195302755,2366115317,997073096,1281953886,3579855332,2724688242,1006888145,1258607687,3524101629,2768942443,
  901097722,1119000684,3686517206,2898065728,853044451,1172266101,3705015759,2882616665,651767980,1373503546,
  3369554304,3218104598,565507253,1454621731,3485111705,3099436303,671266974,1594198024,3322730930,2970347812,
  795835527,1483230225,3244367275,3060149565,1994146192,31158534,2563907772,4023717930,1907459465,112637215,
  2680153253,3904427059,2013776290,251722036,2517215374,3775830040,2137656763,141376813,2439277719,3865271297,
  1802195444,476864866,2238001368,4066508878,1812370925,453092731,2181625025,4111451223,1706088902,314042704,
  2344532202,4240017532,1658658271,366619977,2362670323,4224994405,1303535960,984961486,2747007092,3569037538,
  1256170817,1037604311,2765210733,3554079995,1131014506,879679996,2909243462,3663771856,1141124467,855842277,
  2852801631,3708648649,1342533948,654459306,3188396048,3373015174,1466479909,544179635,3110523913,3462522015,
  1591671054,702138776,2966460450,3352799412,1504918807,783551873,3082640443,3233442989,3988292384,2596254646,
  62317068,1957810842,3939845945,2647816111,81470997,1943803523,3814918930,2489596804,225274430,2053790376,
  3826175755,2466906013,167816743,2097651377,4027552580,2265490386,503444072,1762050814,4150417245,2154129355,
  426522225,1852507879,4275313526,2312317920,282753626,1742555852,4189708143,2394877945,397917763,1622183637,
  3604390888,2714866558,953729732,1340076626,3518719985,2797360999,1068828381,1219638859,3624741850,2936675148,
  906185462,1090812512,3747672003,2825379669,829329135,1181335161,3412177804,3160834842,628085408,1382605366,
  3423369109,3138078467,570562233,1426400815,3317316542,2998733608,733239954,1555261956,3268935591,3050360625,
  752459403,1541320221,2607071920,3965973030,1969922972,40735498,2617837225,3943577151,1913087877,83908371,
  2512341634,3803740692,2075208622,213261112,2463272603,3855990285,2094854071,198958881,2262029012,4057260610,
  1759359992,534414190,2176718541,4139329115,1873836001,414664567,2282248934,4279200368,1711684554,285281116,
  2405801727,4167216745,1634467795,376229701,2685067896,3608007406,1308918612,956543938,2808555105,3495958263,
  1231636301,1047427035,2932959818,3654703836,1088359270,936918000,2847714899,3736837829,1202900863,817233897,
  3183342108,3401237130,1404277552,615818150,3134207493,3453421203,1423857449,601450431,3009837614,3294710456,
  1567103746,711928724,3020668471,3272380065,1510334235,755167117
];

/**
 * Calculates the checksum of an array of bytes, with crc-32.
 * Based on:
 * https://stackoverflow.com/questions/18638900/javascript-crc32
 * @arg bytes, array of bytes.
 * @returns Number.
 */
Zipper.bytesToCrc32 = function (bytes) {

  // https://stackoverflow.com/questions/18638900/javascript-crc32

  let crc = -1;

  for (let i = 0, iTop = bytes.length; i < iTop; i++) {
    crc = (crc >>> 8) ^ this._CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }

  return (crc ^ (-1)) >>> 0;

};

/**
 * Converts an array of bytes into a string.
 * @arg bytes, array of bytes.
 * @returns String.
 */
Zipper.bytesToString = function (bytes) {

  let str = '';

  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }

  return str;
};

/**
 * Converts a string into an array of bytes.
 * Byte codes will be wrapped if they exceed the 0-255 range.
 * @arg str, string.
 * @returns Uint8Array, with same length as string.
 */
Zipper.stringToBytes = function (str) {

  const arr = new Uint8Array(str.length);

  for (let i = 0; i < arr.length; i++) {
    arr[i] = str.charCodeAt(i);
  }

  return arr;
};

/**
 * Converts an array of bytes in Zip format, to a number.
 * @arg bytes, array of bytes.
 * @returns Integer.
 */
Zipper.bytesToNumber = function (bytes) {

  let n = 0;
  let i = bytes.length - 1;

  while (i >= 0) {
    n <<= 8;
    n += bytes[i] & 0xFF;
    i -= 1;
  }

  return n;
};

/**
 * Converts a number to an array of bytes in Zip format.
 * In Zip format, each consecutive byte represents a larger power:
 * (first byte, 0 - 255) (second byte, next 8 powers), etc.
 * So 0xFF44 becomes (0x44), (0xFF), (pad of 0s).
 * @arg n, number.
 * @arg pad, number of 0 bytes to pad after number.
 * @returns Uint8Array of 'pad' length.
 */
Zipper.numberToBytes = function (n, pad) {

  // NOTE: Numbers in zip files get larger as they travel to the right.
  // Eg. (first 8 powers), (next 8 powers)...

  const bytes = new Uint8Array(pad);
  let i = 0;

  while (i < pad) {
    bytes[i] = n & 0xFF;
    n >>= 8;
    i += 1;
  }

  return bytes;
};

/**
 * Converts a Date object to an array of 2 bytes, representing the date.
 * @arg date, Date object.
 * @returns Date.
 */
Zipper.dateToBytes = function (date) {

  // {7 bytes for year since 1980}{4 bytes for month (1 - 12)}{5 bytes for day (1 - 31)}

  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear() - 1980;
  const n = (year << 9) + (month << 5) + day;
  return this.numberToBytes(n, 2);
};

/**
 * Converts a Date object to an array of 2 bytes, representing the time.
 * @arg date, Date object.
 * @returns Date.
 */
Zipper.timeToBytes = function (date) {

  // {5 bytes for hour}{6 bytes for minutes}{5 bytes for Seconds divided by 2}

  const h = date.getHours();
  const m = date.getMinutes();
  const s = Math.floor(date.getSeconds() * 0.5);
  const n = (h << 11) + (m << 5) + s;
  return this.numberToBytes(n, 2);
};

/**
 * Converts an array of 2 date bytes (in Zip format) to a Date object.
 * @arg bytes, array of 2 bytes. 
 * @returns Date.
 */
Zipper.bytesToDate = function (bytes) {

  // {7 bytes for year since 1980}{4 bytes for month (1 - 12)}{5 bytes for day (1 - 31)}

  const n = this.bytesToNumber(bytes);
  const day = n & 31;
  const month = ((n >> 5) & 15) - 1;
  const year = ((n >> 9) & 127) + 1980;

  const d = new Date(0);
  d.setFullYear(year, month, day);
  return d;
};

/**
 * Converts an array of 2 time bytes (in Zip format) to a Date object.
 * @arg bytes, array of 2 bytes. 
 * @returns Date.
 */
Zipper.bytesToTime = function (bytes) {

  // {5 bytes for hour}{6 bytes for minutes}{5 bytes for Seconds divided by 2}

  const n = this.bytesToNumber(bytes);
  const seconds = (n & 31) * 2;
  const minutes = (n >> 5) & 63;
  const hours = (n >> 11) & 31;

  const d = new Date(0);
  d.setHours(hours);
  d.setMinutes(minutes);
  d.setSeconds(seconds);
  return d;
};
