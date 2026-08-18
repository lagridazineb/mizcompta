const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../config/db');
const { signToken } = require('../config/auth');

const router = express.Router();

// La création de comptes est désactivée : MizCompta n'a qu'un seul accès
// (identifiant "admin"), fourni par la société. Cette route reste
// présente (plutôt que supprimée) pour renvoyer une erreur claire si
// quelque chose l'appelle encore, au lieu d'un 404 muet.
router.post('/register', (req, res) => {
  res.status(403).json({ error: "La création de comptes est désactivée. Utilisez l'identifiant fourni par votre administrateur." });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const identifiant = (email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(identifiant);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }
  const token = signToken(user);
  delete user.password_hash;
  res.json({ user, token });
});

module.exports = router;
