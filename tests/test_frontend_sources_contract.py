import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendSourcesContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "frontend" / "src" / "components" / "SourcesTab.tsx").read_text(encoding="utf-8")

    def test_empty_folders_are_not_blocked_by_an_empty_source_list(self):
        self.assertNotIn("deleteConfirmTarget.ids.length === 0) return", self.source)
        self.assertIn("if (deleteConfirmTarget.ids.length > 0)", self.source)

    def test_folder_and_project_structures_are_deleted_after_their_sources(self):
        self.assertIn("structure: { type: 'folder', id: folderId }", self.source)
        self.assertIn("structure: { type: 'project', id: projectId }", self.source)
        self.assertIn("method: 'DELETE'", self.source)
        self.assertIn("getDescendantFolderIds(folders, folderId)", self.source)


if __name__ == "__main__":
    unittest.main()
