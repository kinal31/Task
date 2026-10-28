/**
 * Sample data used to seed an SDK instance.
 * Pure data — no SDK imports, so it can also be used from Node demos.
 */

/**
 * @typedef {object} SeedNode
 * @property {string} name
 * @property {'file'|'folder'} type
 * @property {SeedNode[]} [children] - folders only
 */

/**
 * @typedef {object} SampleData
 * @property {SeedNode[]} children
 */

/**
 * Returns a nested sample structure:
 *
 * My Files
 * ├── Documents
 * │   ├── Work
 * │   │   └── Report.docx
 * │   ├── Resume.pdf
 * │   └── Notes.txt
 * ├── Pictures
 * │   ├── vacation.jpg
 * │   └── profile.png
 * ├── Music
 * │   └── song.mp3
 * └── readme.md
 *
 * @returns {SampleData}
 */
export function createSampleData() {
  return {
    children: [
      {
        name: 'Documents',
        type: 'folder',
        children: [
          {
            name: 'Work',
            type: 'folder',
            children: [{ name: 'Report.docx', type: 'file' }],
          },
          { name: 'Resume.pdf', type: 'file' },
          { name: 'Notes.txt', type: 'file' },
        ],
      },
      {
        name: 'Pictures',
        type: 'folder',
        children: [
          { name: 'vacation.jpg', type: 'file' },
          { name: 'profile.png', type: 'file' },
        ],
      },
      {
        name: 'Music',
        type: 'folder',
        children: [{ name: 'song.mp3', type: 'file' }],
      },
      { name: 'readme.md', type: 'file' },
    ],
  };
}
