// @emoji-mart/data ships its dataset as the package's default export (a big
// JSON), but its bundled index.d.ts only declares the interfaces — not the
// default export. Augment the module so `import data from "@emoji-mart/data"`
// is typed.
declare module "@emoji-mart/data" {
  const data: EmojiMartData;
  export default data;
}
