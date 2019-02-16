
const createArchive = async () => {

  const url1 = 'https://i.imgur.com/Fuhnc2X.jpg';
  const url2 = 'https://i.ytimg.com/vi/SfLV8hD7zX4/maxresdefault.jpg';

  const f1 = await fetch(url1);
  const d1 = await f1.arrayBuffer();

  const zipper = new Zipper();

  zipper.addFile('image.jpg', d1);
  zipper.addFile('text.txt', 'test file');
  zipper.addFile('arrayBuffer.txt', [66, 66, 66, 66, 66]);

  console.log(zipper.getEntries());

  const blob = zipper.toBlob('my comments');
  const url = URL.createObjectURL(blob);

  const el = document.getElementById('link');
  el.setAttribute('href', url);

};


window.onload = function () {

  createArchive();

};
