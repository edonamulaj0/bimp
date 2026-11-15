-- Answers already given: the same question about the same plan, after the same conversation, is answered from here
-- (no model call). The key covers the model, the plan's whole content, the marked region, the question and the turns
-- before it, so a changed plan or a follow-up in another conversation never gets an old answer.
CREATE TABLE answer_cache (key TEXT PRIMARY KEY, answer TEXT NOT NULL, created_at INTEGER NOT NULL);
