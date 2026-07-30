import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendChatContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "frontend" / "src" / "components" / "ChatTab.tsx").read_text(encoding="utf-8")

    def test_search_depth_exposes_independent_crawler_mode(self):
        self.assertIn("'quick' | 'deep' | 'crawler'", self.source)
        self.assertIn('<option value="crawler">', self.source)

    def test_prompt_grows_vertically_to_eight_visible_lines(self):
        self.assertIn('ref={chatInputRef}', self.source)
        self.assertIn('rows={1}', self.source)
        self.assertIn('lineHeight * 8', self.source)
        self.assertIn('minimumHeight = lineHeight + verticalPadding + verticalBorder', self.source)
        self.assertIn('input.style.minHeight', self.source)
        self.assertIn('input.scrollHeight > maximumScrollHeight', self.source)
        self.assertIn('[inputVal, active]', self.source)
        self.assertIn("!e.shiftKey", self.source)

    def test_research_and_sources_use_length_aware_disclosures(self):
        self.assertGreaterEqual(self.source.count('<DisclosureSection'), 2)
        self.assertIn('researchLogsText(msg.search_logs)', self.source)
        self.assertIn('sourcesText(msg.web_sources, msg.citations)', self.source)
        self.assertIn("fa-chevron-right", self.source)
        self.assertIn("rotate-90", self.source)

    def test_historical_user_messages_can_branch_from_an_edit(self):
        self.assertIn('Editar y continuar', self.source)
        self.assertIn('/branch/${editingMessage.id}', self.source)
        self.assertIn('La conversación original permanecerá intacta', self.source)
        self.assertNotIn('history: messages.slice', self.source)


if __name__ == "__main__":
    unittest.main()
