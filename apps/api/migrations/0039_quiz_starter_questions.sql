-- 0039_quiz_starter_questions: starter bank for the "quiz eclair" (lot 20a) so the game can start (it needs 10 active questions).
-- French, RDC and general knowledge, only facts that are stable and well established. Administrators add, retire or replace questions
-- through the admin routes; nothing here is shown with its answer before grading. Forward-only.

INSERT INTO game_questions (prompt, options, correct_index, category) VALUES
  ('Quelle est la capitale de la République démocratique du Congo ?', '["Lubumbashi","Kinshasa","Goma","Kisangani"]', 1, 'RDC'),
  ('Quel grand fleuve traverse la RDC et donne son nom au pays ?', '["Le Nil","Le Niger","Le Congo","Le Zambèze"]', 2, 'RDC'),
  ('En quelle année la RDC est-elle devenue indépendante ?', '["1958","1960","1963","1971"]', 1, 'RDC'),
  ('Quelle est la langue officielle de la RDC ?', '["Le swahili","Le lingala","L’anglais","Le français"]', 3, 'RDC'),
  ('Quelle est la monnaie nationale de la RDC ?', '["Le franc congolais","Le franc CFA","Le shilling","Le kwanza"]', 0, 'RDC'),
  ('Sur les rives de quel lac se trouve la ville de Goma ?', '["Le lac Tanganyika","Le lac Victoria","Le lac Kivu","Le lac Albert"]', 2, 'RDC'),
  ('Quel volcan actif domine la ville de Goma ?', '["Le Nyiragongo","Le Kilimandjaro","Le mont Cameroun","L’Etna"]', 0, 'RDC'),
  ('Quel animal, cousin de la girafe, ne vit à l’état sauvage qu’en RDC ?', '["Le zèbre","L’okapi","Le gnou","L’antilope royale"]', 1, 'RDC'),
  ('Combien de pays ont une frontière commune avec la RDC ?', '["7","8","9","10"]', 2, 'RDC'),
  ('Quel est le plus ancien parc national d’Afrique, situé en RDC ?', '["Le parc de la Garamba","Le parc des Virunga","Le parc de la Salonga","Le parc de Kahuzi-Biega"]', 1, 'RDC'),
  ('Qui fut le premier président de la RDC indépendante ?', '["Patrice Lumumba","Joseph Kasa-Vubu","Mobutu Sese Seko","Laurent-Désiré Kabila"]', 1, 'RDC'),
  ('Quel est le deuxième plus grand pays d’Afrique par sa superficie ?', '["Le Soudan","La Libye","Le Tchad","La RDC"]', 3, 'RDC'),
  ('Quelle est la capitale du Rwanda ?', '["Kampala","Kigali","Bujumbura","Nairobi"]', 1, 'Afrique'),
  ('Quelle est la capitale de l’Ouganda ?', '["Kampala","Kigali","Dar es Salaam","Lusaka"]', 0, 'Afrique'),
  ('Quelle est la capitale officielle de la Tanzanie ?', '["Dar es Salaam","Arusha","Dodoma","Zanzibar"]', 2, 'Afrique'),
  ('Quel océan borde la côte ouest de l’Afrique ?', '["L’océan Indien","L’océan Atlantique","L’océan Pacifique","L’océan Arctique"]', 1, 'Afrique'),
  ('Selon le découpage le plus courant, combien y a-t-il de continents sur Terre ?', '["5","6","7","8"]', 2, 'Culture générale'),
  ('Quelle planète est la plus proche du Soleil ?', '["Vénus","Mars","Mercure","La Terre"]', 2, 'Culture générale'),
  ('Quelle est la formule chimique de l’eau ?', '["CO2","H2O","O2","NaCl"]', 1, 'Culture générale'),
  ('Quelle est la capitale de la France ?', '["Lyon","Marseille","Paris","Bruxelles"]', 2, 'Culture générale');
