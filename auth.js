/* ============================================================
   LUNCHBOXD — Système de comptes
   Auth    : Firebase Authentication (email/password)
   Données : Firebase Firestore + Storage
   ============================================================

   ⚠️  CONFIGURATION FIREBASE :
   Remplace les valeurs ci-dessous par ta config Firebase.
   (Normalement tu gardes la même que v12.)

   ⚠️  ÉTAPES FIREBASE À FAIRE UNE FOIS :
   1. Va sur https://console.firebase.google.com → ton projet
   2. Authentication → Get started → Email/Password → Activer → Save
   3. Firestore → Rules → colle les règles du fichier FIREBASE_RULES.txt
   4. Storage → Rules → colle les règles du fichier FIREBASE_RULES.txt

   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBh7HtGANcPnf9Xv4q8mHq9JjNqISyGC7k",
  authDomain:        "lunchboxd-593b1.firebaseapp.com",
  projectId:         "lunchboxd-593b1",
  storageBucket:     "lunchboxd-593b1.firebasestorage.app",
  messagingSenderId: "619634159869",
  appId:             "1:619634159869:web:5c9727b0af4880d5c3ce94",
};

/* ── INITIALISATION FIREBASE ── */

let db      = null;
let storage = null;
let auth    = null;
let firebaseReady = false;

// Résout quand Firebase est prêt ET que l'état auth initial est connu
let _firebaseInitResolve;
const firebaseInitPromise = new Promise(r => { _firebaseInitResolve = r; });

(function initFirebase() {
  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = () => { console.warn('Firebase CDN inaccessible.'); cb(); };
    document.head.appendChild(s);
  }

  const BASE = 'https://www.gstatic.com/firebasejs/9.23.0/';
  loadScript(BASE + 'firebase-app-compat.js', function() {
    loadScript(BASE + 'firebase-auth-compat.js', function() {
      loadScript(BASE + 'firebase-firestore-compat.js', function() {
        loadScript(BASE + 'firebase-storage-compat.js', function() {
          try {
            if (typeof firebase === 'undefined') {
              console.warn('Firebase CDN inaccessible.');
              _firebaseInitResolve(false);
              return;
            }
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            db      = firebase.firestore();
            storage = firebase.storage();
            auth    = firebase.auth();
            firebaseReady = true;
            console.log('Firebase connecté ✓ (Auth + Firestore + Storage)');

            // On attend que Firebase Auth ait résolu l'état initial
            // (connecté ou pas) avant de résoudre la promise globale
            const unsubscribe = auth.onAuthStateChanged(function(user) {
              unsubscribe(); // on écoute une seule fois
              _firebaseInitResolve(true);
              // Met à jour la nav à chaque changement d'état auth
              Auth.updateNav();
            });

            // Écoute permanente pour mettre à jour la nav sur logout/login
            auth.onAuthStateChanged(function() {
              Auth.updateNav();
            });

          } catch(e) {
            console.warn('Erreur init Firebase :', e.message);
            _firebaseInitResolve(false);
          }
        });
      });
    });
  });
})();

/* Attend que Firebase soit prêt (retourne une Promise<bool>) */
function waitForFirebase() {
  return firebaseInitPromise;
}

/* ── HELPERS SESSION ──
   On ne stocke plus les mots de passe dans Firestore.
   La session est gérée par Firebase Auth (token persistant).
   On garde un cache léger dans localStorage pour lire pseudo/avatar
   sans attendre Firestore sur chaque page. */

function _cacheSession(user) {
  if (!user) { localStorage.removeItem('lb_session'); return; }
  localStorage.setItem('lb_session', JSON.stringify({
    id:     user.id,
    pseudo: user.pseudo,
    avatar: user.avatar,
    email:  user.email,
  }));
}

/* ── AUTH ── */

const Auth = {

  /* Retourne le cache session (synchrone, peut être null) */
  getSession() {
    return JSON.parse(localStorage.getItem('lb_session') || 'null');
  },

  /* Retourne true si un utilisateur est connecté selon Firebase Auth */
  isLoggedIn() {
    // Vérification rapide via cache (synchrone)
    // Firebase Auth va confirmer/infirmer de manière asynchrone
    if (auth && auth.currentUser) return true;
    return !!this.getSession();
  },

  /* Retourne l'UID Firebase de l'utilisateur connecté, ou null */
  currentUid() {
    return auth && auth.currentUser ? auth.currentUser.uid : null;
  },

  /* DÉCONNEXION */
  logout() {
    _cacheSession(null);
    if (auth) {
      return auth.signOut().then(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  },

  /* ── INSCRIPTION ── */
  register: function(pseudo, email, password, avatar) {
    avatar = avatar || '🧑';
    if (pseudo.length < 3)   return Promise.resolve({ ok: false, error: 'Le pseudo doit faire au moins 3 caractères.' });
    if (pseudo.length > 20)  return Promise.resolve({ ok: false, error: 'Le pseudo ne peut pas dépasser 20 caractères.' });
    if (password.length < 6) return Promise.resolve({ ok: false, error: 'Le mot de passe doit faire au moins 6 caractères.' });

    return waitForFirebase().then(function(ready) {
      if (!ready) {
        return { ok: false, error: 'Impossible de joindre Firebase. Vérifie ta connexion.' };
      }

      // 1. Vérifie que le pseudo n'est pas déjà pris
      return db.collection('users').where('pseudoLower', '==', pseudo.toLowerCase()).get()
        .then(function(snap) {
          if (!snap.empty) return { ok: false, error: 'Ce pseudo est déjà pris.' };

          // 2. Crée le compte Firebase Auth
          return auth.createUserWithEmailAndPassword(email, password);
        })
        .then(function(result) {
          if (result && result.ok === false) return result; // erreur pseudo
          const firebaseUser = result.user;
          const uid = firebaseUser.uid;

          const userData = {
            id:          uid,
            pseudo:      pseudo,
            pseudoLower: pseudo.toLowerCase(),
            email:       email,
            emailLower:  email.toLowerCase(),
            avatar:      avatar,
            joinedAt:    new Date().toISOString(),
            reviews:     [],
          };

          // 3. Crée le profil dans Firestore
          return db.collection('users').doc(uid).set(userData)
            .then(function() {
              _cacheSession(userData);
              return { ok: true, user: userData };
            });
        })
        .catch(function(e) {
          // Erreurs Firebase Auth avec messages en français
          const msgs = {
            'auth/email-already-in-use': 'Cet email est déjà utilisé.',
            'auth/invalid-email':        'Adresse email invalide.',
            'auth/weak-password':        'Mot de passe trop faible (min. 6 caractères).',
            'auth/network-request-failed': 'Erreur réseau. Vérifie ta connexion.',
          };
          return { ok: false, error: msgs[e.code] || ('Erreur : ' + e.message) };
        });
    });
  },

  /* ── CONNEXION (par pseudo OU email) ── */
  login: function(pseudoOrEmail, password) {
    return waitForFirebase().then(function(ready) {
      if (!ready) {
        return { ok: false, error: 'Impossible de joindre Firebase. Vérifie ta connexion.' };
      }

      // Détermine si c'est un email ou un pseudo
      const isEmail = pseudoOrEmail.includes('@');

      const getEmailPromise = isEmail
        ? Promise.resolve(pseudoOrEmail)
        : db.collection('users')
            .where('pseudoLower', '==', pseudoOrEmail.toLowerCase())
            .get()
            .then(function(snap) {
              if (snap.empty) return null;
              return snap.docs[0].data().email;
            });

      return getEmailPromise
        .then(function(email) {
          if (!email) return { ok: false, error: 'Identifiants incorrects.' };
          return auth.signInWithEmailAndPassword(email, password);
        })
        .then(function(result) {
          if (result && result.ok === false) return result;
          const uid = result.user.uid;
          return db.collection('users').doc(uid).get();
        })
        .then(function(result) {
          if (result && result.ok === false) return result;
          // result est un DocumentSnapshot Firestore
          if (!result.exists) return { ok: false, error: 'Profil introuvable.' };
          const userData = result.data();
          // Vérifie si l'utilisateur est banni
          if (userData.banned) {
            auth.signOut();
            return { ok: false, error: 'Ce compte a été suspendu.' };
          }
          _cacheSession(userData);
          return { ok: true, user: userData };
        })
        .catch(function(e) {
          const msgs = {
            'auth/user-not-found':       'Identifiants incorrects.',
            'auth/wrong-password':       'Identifiants incorrects.',
            'auth/invalid-credential':   'Identifiants incorrects.',
            'auth/too-many-requests':    'Trop de tentatives. Réessaie dans quelques minutes.',
            'auth/network-request-failed': 'Erreur réseau. Vérifie ta connexion.',
          };
          return { ok: false, error: msgs[e.code] || ('Erreur : ' + e.message) };
        });
    });
  },

  /* ── PROFIL ── */
  getProfile: function(id) {
    return waitForFirebase().then(function(ready) {
      if (!ready) return null;
      return db.collection('users').doc(id).get().then(function(doc) {
        return doc.exists ? doc.data() : null;
      }).catch(function() { return null; });
    });
  },

  /* ── COMPRESSION IMAGE ── */
  compressImage: function(file, maxWidth, quality) {
    maxWidth = maxWidth || 1200;
    quality  = quality  || 0.75;
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          var w = img.width, h = img.height;
          if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(function(blob) { resolve(blob); }, 'image/jpeg', quality);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  /* ── UPLOAD IMAGE ── */
  uploadImage: function(file, reviewId) {
    var self = this;
    return new Promise(function(resolve) {
      if (!firebaseReady || !storage) return resolve({ ok: false, error: 'Storage non disponible.' });
      if (file.size > 10 * 1024 * 1024) return resolve({ ok: false, error: 'Image trop lourde (max 10 MB).' });
      var ext = file.name.split('.').pop().toLowerCase();
      var allowed = ['jpg','jpeg','png','gif','webp'];
      if (!allowed.includes(ext)) return resolve({ ok: false, error: 'Format non supporté (jpg, png, gif, webp).' });

      self.compressImage(file).then(function(blob) {
        var path = 'reviews/' + reviewId + '.jpg';
        var ref  = storage.ref(path);
        var task = ref.put(blob, { contentType: 'image/jpeg' });
        task.on('state_changed',
          function(snap) { console.log('Upload ' + Math.round(snap.bytesTransferred / snap.totalBytes * 100) + '%'); },
          function(err)  { resolve({ ok: false, error: 'Erreur upload: ' + err.message }); },
          function()     {
            ref.getDownloadURL().then(function(url) { resolve({ ok: true, url: url }); });
          }
        );
      });
    });
  },

  /* ── AJOUTER UN AVIS ── */
  addReview: function(mealName, rating, comment, imageUrl) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    var review = {
      id: Date.now().toString(),
      mealName: mealName, rating: rating, comment: comment,
      imageUrl: imageUrl || null,
      date: new Date().toISOString(),
      likes: [],
    };
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(session.id);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = [review].concat(doc.data().reviews || []);
        return ref.update({ reviews: reviews }).then(function() {
          return { ok: true, review: review };
        });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── MODIFIER UN AVIS ── */
  editReview: function(reviewId, mealName, rating, comment, imageUrl) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(session.id);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = doc.data().reviews || [];
        var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
        if (idx === -1) return { ok: false, error: 'Avis introuvable.' };
        reviews[idx].mealName = mealName;
        reviews[idx].rating   = rating;
        reviews[idx].comment  = comment;
        if (imageUrl !== undefined) reviews[idx].imageUrl = imageUrl;
        reviews[idx].editedAt = new Date().toISOString();
        return ref.update({ reviews: reviews }).then(function() { return { ok: true }; });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── SUPPRIMER UN AVIS ── */
  deleteReview: function(reviewId) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(session.id);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = (doc.data().reviews || []).filter(function(r){ return r.id !== reviewId; });
        return ref.update({ reviews: reviews }).then(function() { return { ok: true }; });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── CROQUER UN AVIS ── */
  toggleCroc: function(authorId, reviewId) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false };
      var ref = db.collection('users').doc(authorId);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false };
        var reviews = doc.data().reviews || [];
        var review  = reviews.find(function(r){ return r.id === reviewId; });
        if (!review) return { ok: false };
        if (!review.crocs) review.crocs = [];
        var idx = review.crocs.indexOf(session.id);
        if (idx === -1) { review.crocs.push(session.id); }
        else            { review.crocs.splice(idx, 1); }
        return ref.update({ reviews: reviews }).then(function() {
          return { ok: true, crocs: review.crocs, croced: idx === -1 };
        });
      });
    }).catch(function() { return { ok: false }; });
  },

  /* ── SUIVRE / NE PLUS SUIVRE ── */
  toggleFollow: function(targetId) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (session.id === targetId) return Promise.resolve({ ok: false, error: 'Impossible de se suivre soi-même.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false };
      var meRef     = db.collection('users').doc(session.id);
      var targetRef = db.collection('users').doc(targetId);
      return Promise.all([meRef.get(), targetRef.get()]).then(function(docs) {
        var meData      = docs[0].data() || {};
        var targetData  = docs[1].data() || {};
        var myFollowing = meData.following    || [];
        var theirFol    = targetData.followers || [];
        var idx = myFollowing.indexOf(targetId);
        var following;
        if (idx === -1) {
          myFollowing.push(targetId);
          if (!theirFol.includes(session.id)) theirFol.push(session.id);
          following = true;
        } else {
          myFollowing.splice(idx, 1);
          var fi = theirFol.indexOf(session.id);
          if (fi !== -1) theirFol.splice(fi, 1);
          following = false;
        }
        return Promise.all([
          meRef.update({ following: myFollowing }),
          targetRef.update({ followers: theirFol }),
        ]).then(function() {
          return { ok: true, following: following, followersCount: theirFol.length };
        });
      });
    }).catch(function() { return { ok: false }; });
  },

  /* ── VÉRIFIE SI ON SUIT ── */
  isFollowing: function(targetId) {
    var session = this.getSession();
    if (!session) return Promise.resolve(false);
    return waitForFirebase().then(function(ready) {
      if (!ready) return false;
      return db.collection('users').doc(session.id).get().then(function(doc) {
        var data = doc.exists ? doc.data() : {};
        return (data.following || []).includes(targetId);
      });
    }).catch(function() { return false; });
  },

  /* ── TOUTES LES CRITIQUES ── */
  getAllReviews: function() {
    return waitForFirebase().then(function(ready) {
      if (!ready) return [];
      return db.collection('users').get().then(function(snap) {
        var all = [];
        snap.forEach(function(doc) {
          var u = doc.data();
          (u.reviews || []).forEach(function(r) {
            all.push(Object.assign({}, r, { authorPseudo: u.pseudo, authorAvatar: u.avatar, authorId: u.id, authorData: u }));
          });
        });
        all.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
        return all;
      });
    }).catch(function(){ return []; });
  },

  /* ── AJOUTER UNE RÉPONSE ── */
  addReply: function(authorId, reviewId, text) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (!text || !text.trim()) return Promise.resolve({ ok: false, error: 'La réponse est vide.' });
    var reply = {
      id: Date.now().toString(),
      authorId:     session.id,
      authorPseudo: session.pseudo,
      authorAvatar: session.avatar,
      text: text.trim(),
      date: new Date().toISOString(),
    };
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(authorId);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = doc.data().reviews || [];
        var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
        if (idx === -1) return { ok: false, error: 'Avis introuvable.' };
        if (!reviews[idx].replies) reviews[idx].replies = [];
        reviews[idx].replies.push(reply);
        return ref.update({ reviews: reviews }).then(function() { return { ok: true, reply: reply }; });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── SUPPRIMER UNE RÉPONSE ── */
  deleteReply: function(authorId, reviewId, replyId) {
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(authorId);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = doc.data().reviews || [];
        var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
        if (idx === -1) return { ok: false, error: 'Avis introuvable.' };
        reviews[idx].replies = (reviews[idx].replies || []).filter(function(rp){ return rp.id !== replyId; });
        return ref.update({ reviews: reviews }).then(function() { return { ok: true }; });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── TOUS LES UTILISATEURS ── */
  getUsers: function() {
    return waitForFirebase().then(function(ready) {
      if (!ready) return [];
      return db.collection('users').get().then(function(snap) {
        return snap.docs.map(function(d){ return d.data(); });
      });
    }).catch(function(){ return []; });
  },

  /* ── ADMIN ── */

  ADMIN_EMAIL: 'e.ernest.oiry@gmail.com',

  isAdmin: function() {
    var session = this.getSession();
    if (!session) return Promise.resolve(false);
    var self = this;
    return waitForFirebase().then(function(ready) {
      if (!ready) return false;
      return db.collection('users').doc(session.id).get().then(function(doc) {
        return doc.exists && doc.data().email && doc.data().email.toLowerCase() === self.ADMIN_EMAIL;
      });
    }).catch(function(){ return false; });
  },

  adminDeleteReview: function(authorId, reviewId) {
    var self = this;
    return self.isAdmin().then(function(ok) {
      if (!ok) return { ok: false, error: 'Accès refusé.' };
      return waitForFirebase().then(function(ready) {
        if (!ready) return { ok: false, error: 'Erreur réseau.' };
        var ref = db.collection('users').doc(authorId);
        return ref.get().then(function(doc) {
          if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
          var reviews = (doc.data().reviews || []).filter(function(r){ return r.id !== reviewId; });
          return ref.update({ reviews: reviews }).then(function() { return { ok: true }; });
        });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  getMenu: function() {
    return waitForFirebase().then(function(ready) {
      if (!ready) return {};
      return db.collection('config').doc('menu').get().then(function(doc) {
        return doc.exists ? doc.data() : {};
      });
    }).catch(function(){ return {}; });
  },

  saveMenu: function(menuData) {
    var self = this;
    return self.isAdmin().then(function(ok) {
      if (!ok) return { ok: false, error: 'Accès refusé.' };
      return waitForFirebase().then(function(ready) {
        if (!ready) return { ok: false, error: 'Erreur réseau.' };
        return db.collection('config').doc('menu').set(menuData)
          .then(function() { return { ok: true }; });
      });
    });
  },

  adminToggleBan: function(userId) {
    var self = this;
    return self.isAdmin().then(function(ok) {
      if (!ok) return { ok: false, error: 'Accès refusé.' };
      return waitForFirebase().then(function(ready) {
        if (!ready) return { ok: false, error: 'Erreur réseau.' };
        var ref = db.collection('users').doc(userId);
        return ref.get().then(function(doc) {
          if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
          var banned = !doc.data().banned;
          return ref.update({ banned: banned }).then(function() { return { ok: true, banned: banned }; });
        });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── NAV ── */
  updateNav: function() {
    var session = this.getSession();
    var actionsEl = document.querySelector('.nav-actions');
    if (!actionsEl) return;
    var self = this;
    if (session) {
      self.isAdmin().then(function(isAdm) {
        var adminLink = isAdm ? '<a class="btn-admin-nav" href="admin.html" title="Panneau admin">⚙ Admin</a>' : '';
        actionsEl.innerHTML =
          adminLink +
          '<a href="profil.html" class="nav-profil-btn">' +
            '<span class="nav-avatar">' + session.avatar + '</span>' +
            '<span class="nav-pseudo">' + session.pseudo + '</span>' +
          '</a>' +
          '<button class="btn-ghost" onclick="Auth.logout()">Déconnexion</button>';
      });
    } else {
      actionsEl.innerHTML =
        '<a class="btn-ghost" href="connexion.html">Connexion</a>' +
        '<a class="btn-primary" href="inscription.html">Créer un compte</a>';
    }
  },

  /* ── MOTS INTERDITS ── */
  getBannedWords: function() {
    return waitForFirebase().then(function(ready) {
      if (!ready) return [];
      return db.collection('config').doc('banned_words').get().then(function(doc) {
        return doc.exists ? (doc.data().words || []) : [];
      });
    }).catch(function() { return []; });
  },

  adminSetBannedWords: function(words) {
    var self = this;
    return self.isAdmin().then(function(ok) {
      if (!ok) return { ok: false, error: 'Accès refusé.' };
      return waitForFirebase().then(function(ready) {
        if (!ready) return { ok: false, error: 'Erreur réseau.' };
        return db.collection('config').doc('banned_words').set({ words: words })
          .then(function() { return { ok: true }; });
      });
    });
  },

  checkBannedWords: function(text) {
    return this.getBannedWords().then(function(words) {
      if (!words || !words.length) return null;
      var lower = text.toLowerCase();
      for (var i = 0; i < words.length; i++) {
        if (lower.includes(words[i].toLowerCase())) return words[i];
      }
      return null;
    });
  },

  /* ── LIKES ── */
  likeReview: function(authorId, reviewId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (session.id === authorId) return Promise.resolve({ ok: false, error: 'Tu ne peux pas liker ta propre critique.' });
    return waitForFirebase().then(function(ready) {
      if (!ready) return { ok: false, error: 'Erreur réseau.' };
      var ref = db.collection('users').doc(authorId);
      return ref.get().then(function(doc) {
        if (!doc.exists) return { ok: false, error: 'Utilisateur introuvable.' };
        var reviews = doc.data().reviews || [];
        var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
        if (idx === -1) return { ok: false, error: 'Critique introuvable.' };
        if (!reviews[idx].likes) reviews[idx].likes = [];
        var likeIdx = reviews[idx].likes.indexOf(session.id);
        var liked;
        if (likeIdx === -1) { reviews[idx].likes.push(session.id); liked = true; }
        else                { reviews[idx].likes.splice(likeIdx, 1); liked = false; }
        var count = reviews[idx].likes.length;
        return ref.update({ reviews: reviews }).then(function() {
          self.checkAndGrantBadges(authorId);
          return { ok: true, liked: liked, count: count };
        });
      });
    }).catch(function() { return { ok: false, error: 'Erreur réseau.' }; });
  },

  /* ── BADGES ── */
  BADGES: [
    { id: 'first_review',   emoji: '✍️',  label: 'Première critique',  desc: 'A écrit sa 1ère critique',    cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 1; } },
    { id: 'review_5',       emoji: '📝',  label: 'Critique x5',        desc: 'A écrit 5 critiques',          cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 5; } },
    { id: 'review_10',      emoji: '🗒️', label: 'Critique x10',       desc: 'A écrit 10 critiques',         cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 10; } },
    { id: 'review_25',      emoji: '📖',  label: 'Gourmet',            desc: 'A écrit 25 critiques',         cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 25; } },
    { id: 'likes_10',       emoji: '❤️',  label: 'Populaire',          desc: 'A reçu 10 likes au total',     cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 10; } },
    { id: 'likes_50',       emoji: '🔥',  label: 'En feu',             desc: 'A reçu 50 likes au total',     cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 50; } },
    { id: 'likes_100',      emoji: '⭐',  label: 'Star',               desc: 'A reçu 100 likes au total',    cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 100; } },
    { id: 'first_follower', emoji: '👥',  label: 'Premier fan',        desc: 'A obtenu son 1er abonné',      cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 1; } },
    { id: 'followers_10',   emoji: '🌟',  label: 'Influenceur',        desc: 'A obtenu 10 abonnés',          cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 10; } },
    { id: 'followers_50',   emoji: '👑',  label: 'Star du campus',     desc: 'A obtenu 50 abonnés',          cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 50; } },
    { id: 'member_1m',      emoji: '🌱',  label: 'Membre 1 mois',      desc: 'Inscrit depuis 1 mois',        cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 1; } },
    { id: 'member_6m',      emoji: '🌿',  label: 'Membre 6 mois',      desc: 'Inscrit depuis 6 mois',        cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 6; } },
    { id: 'member_1y',      emoji: '🏆',  label: 'Vétéran',            desc: 'Inscrit depuis 1 an',          cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 12; } },
    { id: 'admin',          emoji: '👸',  label: 'Administrateur',     desc: 'Administrateur du site',       cat: 'admin',      condition: function(u){ return u.email && u.email.toLowerCase() === Auth.ADMIN_EMAIL; } },
  ],

  getBestBadges: function(userData) {
    var byCategory = {};
    this.BADGES.forEach(function(b) {
      if (b.condition(userData)) byCategory[b.cat] = b;
    });
    return Object.values(byCategory);
  },

  _totalLikes: function(u) {
    return (u.reviews || []).reduce(function(sum, r){ return sum + (r.likes ? r.likes.length : 0); }, 0);
  },

  _memberMonths: function(u) {
    if (!u.joinedAt) return 0;
    return (Date.now() - new Date(u.joinedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
  },

  getBadges: function(userData) {
    return this.BADGES.filter(function(b){ return b.condition(userData); });
  },

  checkAndGrantBadges: function(userId) {
    var self = this;
    return waitForFirebase().then(function(ready) {
      if (!ready) return;
      return db.collection('users').doc(userId).get().then(function(doc) {
        if (!doc.exists) return;
        var earned = self.getBadges(doc.data()).map(function(b){ return b.id; });
        return db.collection('users').doc(userId).update({ badges: earned }).then(function(){ return earned; });
      });
    }).catch(function(){});
  },

  renderBadges: function(userData, options) {
    options = options || {};
    var badges  = options.all ? this.getBadges(userData) : this.getBestBadges(userData);
    if (!badges.length) return options.empty || '';
    var size    = options.size || 'normal';
    var max     = options.max  || 999;
    var shown   = badges.slice(0, max);
    var wrapStyle  = size === 'small' ? 'display:inline-flex;gap:3px;align-items:center;flex-wrap:wrap;' : 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;';
    var badgeStyle = size === 'small' ? 'font-size:0.85rem;cursor:default;' : 'font-size:1.1rem;cursor:default;background:rgba(200,245,66,0.08);border:1px solid rgba(200,245,66,0.2);border-radius:6px;padding:3px 8px;';
    return '<span style="' + wrapStyle + '">' +
      shown.map(function(b){
        return '<span title="' + b.label + ' — ' + b.desc + '" style="' + badgeStyle + '">' + b.emoji + '</span>';
      }).join('') +
      (badges.length > max ? '<span style="font-size:0.75rem;color:#888;margin-left:2px;">+' + (badges.length - max) + '</span>' : '') +
    '</span>';
  },
};

/* ── STYLES NAV ── */
(function() {
  var style = document.createElement('style');
  style.textContent = `
  .nav-search-wrap { position:relative; display:flex; align-items:center; }
  .nav-search-input {
    background: var(--surface2,#1e1f1a);
    border: 1px solid var(--border,#2a2b25);
    color: var(--text,#e8e6dc);
    border-radius: 20px;
    padding: 0.32rem 0.9rem 0.32rem 2rem;
    font-size: 0.8rem;
    font-family: 'DM Sans', sans-serif;
    width: 180px;
    transition: all 0.2s;
    outline: none;
  }
  .nav-search-input:focus { border-color: var(--accent,#c8f542); width: 220px; }
  .nav-search-icon {
    position:absolute; left:0.6rem; font-size:0.75rem; color:var(--muted,#666); pointer-events:none;
  }
  .nav-search-dropdown {
    position:absolute; top:calc(100% + 8px); left:0; right:0; min-width:280px;
    background: #1a1c17ee;
    border: 1px solid var(--border,#2a2b25);
    border-radius: 10px; z-index:9999; overflow:hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display:none;
  }
  .nav-search-dropdown.open { display:block; }
  .search-section-label {
    font-size:0.6rem; font-family:'DM Mono',monospace; text-transform:uppercase;
    letter-spacing:0.1em; color:var(--muted,#666); padding:8px 12px 4px; border-bottom:1px solid var(--border,#2a2b25);
  }
  .search-result-item {
    display:flex; align-items:center; gap:10px; padding:9px 12px;
    cursor:pointer; transition:background 0.15s; text-decoration:none; color:var(--text,#e8e6dc);
  }
  .search-result-item:hover { background:rgba(200,245,66,0.07); }
  .search-result-avatar { font-size:1.1rem; width:28px; height:28px; display:flex; align-items:center; justify-content:center; background:var(--surface2,#1e1f1a); border-radius:50%; flex-shrink:0; border:1px solid var(--border,#2a2b25); }
  .search-result-name { font-size:0.82rem; font-weight:500; }
  .search-result-sub { font-size:0.68rem; color:var(--muted,#666); font-family:'DM Mono',monospace; }
  .search-empty { padding:14px 12px; font-size:0.8rem; color:var(--muted,#666); text-align:center; }
` + '.nav-profil-btn{display:flex;align-items:center;gap:.5rem;background:var(--surface2,#1e1f1a);border:1px solid var(--border,#2a2b25);padding:.35rem .9rem .35rem .5rem;border-radius:3px;text-decoration:none;transition:border-color .2s}.nav-profil-btn:hover{border-color:var(--accent,#c8f542)}.nav-avatar{font-size:1.1rem}.nav-pseudo{font-size:.82rem;font-weight:500;color:var(--text,#e8e6dc);font-family:"DM Sans",sans-serif}.btn-admin-nav{display:inline-flex;align-items:center;gap:.35rem;background:rgba(232,69,69,0.12);border:1px solid rgba(232,69,69,0.35);color:#e84545;padding:.35rem .9rem;border-radius:3px;text-decoration:none;font-size:.82rem;font-weight:600;font-family:"DM Sans",sans-serif;transition:all .2s}.btn-admin-nav:hover{background:rgba(232,69,69,0.22);border-color:#e84545}';
  document.head.appendChild(style);
})();

/* ── BARRE DE RECHERCHE GLOBALE ── */
(function() {
  function injectSearchBar() {
    var navEls = document.querySelectorAll('nav');
    navEls.forEach(function(nav) {
      if (nav.querySelector('.nav-search-wrap')) return;
      var links = nav.querySelector('.nav-links');
      if (!links) return;
      var wrap = document.createElement('div');
      wrap.className = 'nav-search-wrap';
      wrap.innerHTML =
        '<span class="nav-search-icon">🔍</span>' +
        '<input class="nav-search-input" id="navSearchInput" type="text" placeholder="Rechercher…" autocomplete="off">' +
        '<div class="nav-search-dropdown" id="navSearchDropdown"></div>';
      links.insertAdjacentElement('afterend', wrap);
      var input    = wrap.querySelector('#navSearchInput');
      var dropdown = wrap.querySelector('#navSearchDropdown');
      var timer    = null;
      input.addEventListener('input', function() {
        clearTimeout(timer);
        var q = input.value.trim();
        if (!q) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
        timer = setTimeout(function(){ doSearch(q, dropdown); }, 200);
      });
      input.addEventListener('focus', function() {
        if (input.value.trim()) dropdown.classList.add('open');
      });
      document.addEventListener('click', function(e) {
        if (!wrap.contains(e.target)) dropdown.classList.remove('open');
      });
    });
  }

  async function doSearch(q, dropdown) {
    dropdown.classList.add('open');
    dropdown.innerHTML = '<div class="search-empty">Recherche…</div>';
    var lower = q.toLowerCase();
    try {
      var users      = await Auth.getUsers();
      var allReviews = await Auth.getAllReviews();
      var matchedUsers = users.filter(function(u){ return u.pseudo && u.pseudo.toLowerCase().includes(lower); }).slice(0, 5);
      var mealMap = {};
      allReviews.forEach(function(r) {
        var name = r.mealName || '';
        if (name.toLowerCase().includes(lower)) {
          if (!mealMap[name]) mealMap[name] = { name: name, count: 0 };
          mealMap[name].count++;
        }
      });
      var matchedMeals = Object.values(mealMap).sort(function(a,b){ return b.count - a.count; }).slice(0, 5);
      if (!matchedUsers.length && !matchedMeals.length) {
        dropdown.innerHTML = '<div class="search-empty">Aucun résultat pour «\u00a0' + q + '\u00a0»</div>';
        return;
      }
      var html = '';
      if (matchedUsers.length) {
        html += '<div class="search-section-label">👤 Utilisateurs</div>';
        matchedUsers.forEach(function(u) {
          var badges = Auth.renderBadges(u, {size:'small', max:2});
          html += '<a class="search-result-item" href="profil-public.html?id=' + u.id + '">' +
            '<span class="search-result-avatar">' + (u.avatar || '🧑') + '</span>' +
            '<span><div class="search-result-name">' + u.pseudo + ' ' + badges + '</div>' +
            '<div class="search-result-sub">@' + u.pseudo.toLowerCase().replace(/\s+/g,'_') + ' · ' + (u.reviews||[]).length + ' avis</div></span></a>';
        });
      }
      if (matchedMeals.length) {
        html += '<div class="search-section-label">🍽️ Plats</div>';
        matchedMeals.forEach(function(m) {
          html += '<a class="search-result-item" href="critiques.html">' +
            '<span class="search-result-avatar">🍴</span>' +
            '<span><div class="search-result-name">' + m.name + '</div>' +
            '<div class="search-result-sub">' + m.count + ' critique' + (m.count > 1 ? 's' : '') + '</div></span></a>';
        });
      }
      dropdown.innerHTML = html;
    } catch(e) {
      dropdown.innerHTML = '<div class="search-empty">Erreur de recherche.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    injectSearchBar();
    setTimeout(injectSearchBar, 800);
  });
})();

/* ── POP-UP WANTED ── */
(function() {
  var PAGE_THRESHOLD = 3;
  var STORAGE_KEY    = 'lb_page_count';
  function getCount()       { return parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10); }
  function incrementCount() { var c = getCount() + 1; sessionStorage.setItem(STORAGE_KEY, c); return c; }

  function showWantedPopup() {
    if (document.getElementById('wantedOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';
    overlay.innerHTML = `<div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:380px;width:90%;max-height:90vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 0 60px rgba(200,245,66,0.15);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);"><div style="background:#c8f542;padding:12px 20px;text-align:center;"><div style="font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;color:#000;font-weight:700;">⚠️ AVIS DE RECHERCHE ⚠️</div><div style="font-family:'Playfair Display',serif;font-size:1.6rem;font-weight:900;color:#000;letter-spacing:0.1em;">WANTED</div></div><div style="position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0d0e0b;"><img src="wanted.jpg" alt="Suspect" style="width:100%;display:block;filter:sepia(30%) contrast(1.1);"><div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(transparent,#1a1c17);"></div></div><div style="padding:16px 20px 20px;text-align:center;"><div style="font-family:'DM Mono',monospace;font-size:0.7rem;color:#c8f542;letter-spacing:0.1em;margin-bottom:8px;">INDIVIDU DANGEREUX</div><div style="font-family:'Playfair Display',serif;font-size:1rem;color:#e8e6dc;line-height:1.5;margin-bottom:6px;">Cet individu est activement recherché pour le <strong style="color:#c8f542;">vol de yaourts</strong> à la cantine.</div><div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">Si vous le reconnaissez, signalez-le immédiatement à la direction.</div><div style="font-size:0.7rem;color:#555;margin-bottom:14px;">Récompense : 1 yaourt à la fraise 🍓</div><button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');" style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;width:100%;" onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">✅ Message reçu, je reste vigilant</button></div></div>`;
    _addPopupStyles();
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){ if (e.target===overlay){overlay.remove();sessionStorage.setItem('lb_page_count','0');} });
  }

  function showPommesSmilePopup() {
    if (document.getElementById('wantedOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';
    overlay.innerHTML = `<div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:360px;width:90%;max-height:90vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 0 60px rgba(200,245,66,0.2);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);text-align:center;"><div style="background:#c8f542;padding:14px 20px;"><div style="font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:900;color:#000;">🍎 POMMES SMILE</div><div style="font-family:'DM Mono',monospace;font-size:0.65rem;color:#000;letter-spacing:0.1em;font-weight:700;">À LA CANTINE AUJOURD'HUI !</div></div><div style="overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0d0e0b;"><img src="pommes-smile.png" alt="Pommes smile !" style="width:100%;display:block;"></div><div style="padding:16px 20px 20px;"><div style="font-family:'Playfair Display',serif;font-size:1rem;color:#e8e6dc;margin-bottom:6px;">C'est <strong style="color:#c8f542;">pommes smile</strong> ce midi !!! 🎉</div><div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">La meilleure nouvelle de la journée.</div><button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');" style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;width:100%;" onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">🍎 TROP BIEN !!!</button></div></div>`;
    _addPopupStyles();
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){ if(e.target===overlay){overlay.remove();sessionStorage.setItem('lb_page_count','0');} });
  }

  function showKfcPopup() {
    if (document.getElementById('wantedOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';
    overlay.innerHTML = `<div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:420px;width:90%;overflow:hidden;box-shadow:0 0 60px rgba(200,245,66,0.15);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);text-align:center;"><div style="background:#c8f542;padding:14px 20px;"><div style="font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:900;color:#000;">🤔 LA QUESTION DU JOUR</div></div><div style="overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;"><img src="kfc7.gif" alt="Why was 6 afraid of 7?" style="width:100%;object-fit:contain;"></div><div style="padding:16px 20px 20px;"><div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">Because 7 eight 9 🍗</div><button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');" style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;width:100%;" onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">😂 J'ai compris, laisse moi tranquille</button></div></div>`;
    _addPopupStyles();
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){ if(e.target===overlay){overlay.remove();sessionStorage.setItem('lb_page_count','0');} });
  }

  function _addPopupStyles() {
    if (document.getElementById('wantedStyles')) return;
    var s = document.createElement('style');
    s.id = 'wantedStyles';
    s.textContent = '@keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}@keyframes popIn{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}';
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function() {
    var count = incrementCount();
    if (count >= PAGE_THRESHOLD) {
      var popups = [showWantedPopup, showPommesSmilePopup, showKfcPopup];
      setTimeout(popups[Math.floor(Math.random() * popups.length)], 600);
      sessionStorage.setItem('lb_page_count', '0');
    }
  });
})();

document.addEventListener('DOMContentLoaded', function(){ Auth.updateNav(); });
