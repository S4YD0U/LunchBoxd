/* ============================================================
   LUNCHBOXD — Système de comptes
   Stockage : Firebase Firestore (cross-device) + localStorage (session)
   ============================================================

   ⚠️  CONFIGURATION REQUISE :
   Remplace les valeurs ci-dessous par ta propre config Firebase.
   → Va sur https://console.firebase.google.com
   → Crée un projet → Ajoute une app Web → Copie la config
   → Dans Firestore Database → Crée la base → Mode test (pour commencer)

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

let db = null;
let storage = null;
let firebaseReady = false;

(function initFirebase() {
  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = () => { console.warn('Firebase CDN inaccessible, mode local activé.'); cb(); };
    document.head.appendChild(s);
  }

  loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', function() {
    loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js', function() {
      loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js', function() {
        try {
          if (typeof firebase === 'undefined') return;
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          db = firebase.firestore();
          storage = firebase.storage();
          firebaseReady = true;
          console.log('Firebase connecté ✓ (Firestore + Storage)');
        } catch(e) {
          console.warn('Firebase non configuré, mode localStorage activé.', e.message);
        }
      });
    });
  });
})();

function waitForFirebase(cb, timeout) {
  timeout = timeout || 4000;
  const start = Date.now();
  const check = function() {
    if (firebaseReady && db) return cb(true);
    if (Date.now() - start > timeout) return cb(false);
    setTimeout(check, 80);
  };
  check();
}

/* ── AUTH ── */

const Auth = {

  getSession() {
    return JSON.parse(localStorage.getItem('lb_session') || 'null');
  },

  isLoggedIn() {
    return !!this.getSession();
  },

  logout() {
    localStorage.removeItem('lb_session');
  },

  /* INSCRIPTION */
  register: function(pseudo, email, password) {
    var self = this;
    if (pseudo.length < 3)   return Promise.resolve({ ok: false, error: 'Le pseudo doit faire au moins 3 caractères.' });
    if (password.length < 6) return Promise.resolve({ ok: false, error: 'Le mot de passe doit faire au moins 6 caractères.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          if (users.find(function(u){ return u.pseudo.toLowerCase() === pseudo.toLowerCase(); }))
            return resolve({ ok: false, error: 'Ce pseudo est déjà pris.' });
          if (users.find(function(u){ return u.email.toLowerCase() === email.toLowerCase(); }))
            return resolve({ ok: false, error: 'Cet email est déjà utilisé.' });
          var user = self._createUserObj(pseudo, email, password);
          users.push(user);
          self._localSaveUsers(users);
          localStorage.setItem('lb_session', JSON.stringify({ id: user.id, pseudo: user.pseudo, avatar: user.avatar }));
          return resolve({ ok: true, user: user });
        }

        db.collection('users').where('pseudoLower', '==', pseudo.toLowerCase()).get().then(function(snap) {
          if (!snap.empty) return resolve({ ok: false, error: 'Ce pseudo est déjà pris.' });
          return db.collection('users').where('emailLower', '==', email.toLowerCase()).get();
        }).then(function(snap) {
          if (!snap || snap.empty === false) return; // already resolved above
          if (!snap.empty) return resolve({ ok: false, error: 'Cet email est déjà utilisé.' });
          var user = self._createUserObj(pseudo, email, password);
          return db.collection('users').doc(user.id).set(Object.assign({}, user, {
            pseudoLower: pseudo.toLowerCase(),
            emailLower: email.toLowerCase()
          })).then(function() {
            localStorage.setItem('lb_session', JSON.stringify({ id: user.id, pseudo: user.pseudo, avatar: user.avatar }));
            resolve({ ok: true, user: user });
          });
        }).catch(function(e) {
          resolve({ ok: false, error: 'Erreur réseau. Réessaie.' });
        });
      });
    });
  },

  /* CONNEXION */
  login: function(pseudoOrEmail, password) {
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u) {
            return (u.pseudo.toLowerCase() === pseudoOrEmail.toLowerCase() ||
                    u.email.toLowerCase()  === pseudoOrEmail.toLowerCase()) &&
                    u.password === password;
          });
          if (!user) return resolve({ ok: false, error: 'Identifiants incorrects.' });
          localStorage.setItem('lb_session', JSON.stringify({ id: user.id, pseudo: user.pseudo, avatar: user.avatar }));
          return resolve({ ok: true, user: user });
        }

        db.collection('users').where('pseudoLower', '==', pseudoOrEmail.toLowerCase()).get()
        .then(function(snap) {
          if (!snap.empty) return snap;
          return db.collection('users').where('emailLower', '==', pseudoOrEmail.toLowerCase()).get();
        }).then(function(snap) {
          if (snap.empty) return resolve({ ok: false, error: 'Identifiants incorrects.' });
          var userData = snap.docs[0].data();
          if (userData.password !== password) return resolve({ ok: false, error: 'Identifiants incorrects.' });
          localStorage.setItem('lb_session', JSON.stringify({ id: userData.id, pseudo: userData.pseudo, avatar: userData.avatar }));
          resolve({ ok: true, user: userData });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau. Réessaie.' });
        });
      });
    });
  },

  /* PROFIL */
  getProfile: function(id) {
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) return resolve(self._localGetUsers().find(function(u){ return u.id === id; }) || null);
        db.collection('users').doc(id).get().then(function(doc) {
          resolve(doc.exists ? doc.data() : null);
        }).catch(function() { resolve(null); });
      });
    });
  },

  /* COMPRESSION IMAGE */
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
          // Redimensionne si trop large
          if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function(blob) {
            resolve(blob);
          }, 'image/jpeg', quality);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  /* UPLOAD IMAGE */
  uploadImage: function(file, reviewId) {
    var self = this;
    return new Promise(function(resolve) {
      if (!firebaseReady || !storage) return resolve({ ok: false, error: 'Storage non disponible.' });
      if (file.size > 10 * 1024 * 1024) return resolve({ ok: false, error: 'Image trop lourde (max 10 MB).' });
      var ext = file.name.split('.').pop().toLowerCase();
      var allowed = ['jpg','jpeg','png','gif','webp'];
      if (!allowed.includes(ext)) return resolve({ ok: false, error: 'Format non supporté (jpg, png, gif, webp).' });

      // Compresse avant upload → max 1200px, qualité 75% → ~100-300KB
      self.compressImage(file).then(function(blob) {
        var path = 'reviews/' + reviewId + '.jpg';
        var ref = storage.ref(path);
        var task = ref.put(blob, { contentType: 'image/jpeg' });

        task.on('state_changed',
          function(snap) {
            var pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
            console.log('Upload ' + pct + '%');
          },
          function(err) { resolve({ ok: false, error: 'Erreur upload: ' + err.message }); },
          function() {
            ref.getDownloadURL().then(function(url) {
              var ratio = Math.round((1 - blob.size / file.size) * 100);
              console.log('Image compressée : ' + Math.round(file.size/1024) + 'KB → ' + Math.round(blob.size/1024) + 'KB (-' + ratio + '%)');
              resolve({ ok: true, url: url });
            });
          }
        );
      });
    });
  },

  /* AJOUTER UN AVIS */
  addReview: function(mealName, rating, comment, imageUrl) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    var review = {
      id: Date.now().toString(),
      mealName: mealName, rating: rating, comment: comment,
      imageUrl: imageUrl || null,
      date: new Date().toISOString()
    };

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === session.id; });
          if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          user.reviews.unshift(review);
          self._localSaveUsers(users);
          return resolve({ ok: true, review: review });
        }
        var ref = db.collection('users').doc(session.id);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = [review].concat(doc.data().reviews || []);
          return ref.update({ reviews: reviews });
        }).then(function() {
          resolve({ ok: true, review: review });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau.' });
        });
      });
    });
  },

  /* MODIFIER UN AVIS */
  editReview: function(reviewId, mealName, rating, comment, imageUrl) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === session.id; });
          if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var review = user.reviews.find(function(r){ return r.id === reviewId; });
          if (!review) return resolve({ ok: false, error: 'Avis introuvable.' });
          review.mealName = mealName;
          review.rating = rating;
          review.comment = comment;
          if (imageUrl !== undefined) review.imageUrl = imageUrl;
          review.editedAt = new Date().toISOString();
          self._localSaveUsers(users);
          return resolve({ ok: true });
        }
        var ref = db.collection('users').doc(session.id);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = doc.data().reviews || [];
          var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
          if (idx === -1) return resolve({ ok: false, error: 'Avis introuvable.' });
          reviews[idx].mealName = mealName;
          reviews[idx].rating = rating;
          reviews[idx].comment = comment;
          if (imageUrl !== undefined) reviews[idx].imageUrl = imageUrl;
          reviews[idx].editedAt = new Date().toISOString();
          reviews[idx].editedAt = new Date().toISOString();
          return ref.update({ reviews: reviews });
        }).then(function() {
          resolve({ ok: true });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau.' });
        });
      });
    });
  },

  /* SUPPRIMER UN AVIS */
  deleteReview: function(reviewId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === session.id; });
          if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var idx = user.reviews.findIndex(function(r){ return r.id === reviewId; });
          if (idx === -1) return resolve({ ok: false, error: 'Avis introuvable.' });
          user.reviews.splice(idx, 1);
          self._localSaveUsers(users);
          return resolve({ ok: true });
        }
        var ref = db.collection('users').doc(session.id);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = (doc.data().reviews || []).filter(function(r){ return r.id !== reviewId; });
          return ref.update({ reviews: reviews });
        }).then(function() {
          resolve({ ok: true });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau.' });
        });
      });
    });
  },

  /* CROQUER UN AVIS */
  toggleCroc: function(authorId, reviewId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var author = users.find(function(u){ return u.id === authorId; });
          if (!author) return resolve({ ok: false });
          var review = (author.reviews || []).find(function(r){ return r.id === reviewId; });
          if (!review) return resolve({ ok: false });
          if (!review.crocs) review.crocs = [];
          var idx = review.crocs.indexOf(session.id);
          if (idx === -1) { review.crocs.push(session.id); }
          else { review.crocs.splice(idx, 1); }
          self._localSaveUsers(users);
          return resolve({ ok: true, crocs: review.crocs, croced: idx === -1 });
        }
        var ref = db.collection('users').doc(authorId);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false });
          var reviews = doc.data().reviews || [];
          var review = reviews.find(function(r){ return r.id === reviewId; });
          if (!review) return resolve({ ok: false });
          if (!review.crocs) review.crocs = [];
          var idx = review.crocs.indexOf(session.id);
          if (idx === -1) { review.crocs.push(session.id); }
          else { review.crocs.splice(idx, 1); }
          return ref.update({ reviews: reviews }).then(function() {
            resolve({ ok: true, crocs: review.crocs, croced: idx === -1 });
          });
        }).catch(function() { resolve({ ok: false }); });
      });
    });
  },

  /* SUIVRE / NE PLUS SUIVRE UN UTILISATEUR */
  toggleFollow: function(targetId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (session.id === targetId) return Promise.resolve({ ok: false, error: 'Impossible de se suivre soi-même.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var me = users.find(function(u){ return u.id === session.id; });
          var target = users.find(function(u){ return u.id === targetId; });
          if (!me || !target) return resolve({ ok: false });
          if (!me.following) me.following = [];
          if (!target.followers) target.followers = [];
          var idx = me.following.indexOf(targetId);
          var following;
          if (idx === -1) {
            me.following.push(targetId);
            if (!target.followers.includes(session.id)) target.followers.push(session.id);
            following = true;
          } else {
            me.following.splice(idx, 1);
            var fi = target.followers.indexOf(session.id);
            if (fi !== -1) target.followers.splice(fi, 1);
            following = false;
          }
          self._localSaveUsers(users);
          return resolve({ ok: true, following: following, followersCount: target.followers.length });
        }
        var meRef = db.collection('users').doc(session.id);
        var targetRef = db.collection('users').doc(targetId);
        Promise.all([meRef.get(), targetRef.get()]).then(function(docs) {
          var meData = docs[0].data() || {};
          var targetData = docs[1].data() || {};
          var myFollowing = meData.following || [];
          var theirFollowers = targetData.followers || [];
          var idx = myFollowing.indexOf(targetId);
          var following;
          if (idx === -1) {
            myFollowing.push(targetId);
            if (!theirFollowers.includes(session.id)) theirFollowers.push(session.id);
            following = true;
          } else {
            myFollowing.splice(idx, 1);
            var fi = theirFollowers.indexOf(session.id);
            if (fi !== -1) theirFollowers.splice(fi, 1);
            following = false;
          }
          return Promise.all([
            meRef.update({ following: myFollowing }),
            targetRef.update({ followers: theirFollowers })
          ]).then(function() {
            resolve({ ok: true, following: following, followersCount: theirFollowers.length });
          });
        }).catch(function() { resolve({ ok: false }); });
      });
    });
  },

  /* VÉRIFIER SI ON SUIT UN UTILISATEUR */
  isFollowing: function(targetId) {
    var session = this.getSession();
    if (!session) return Promise.resolve(false);
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var me = self._localGetUsers().find(function(u){ return u.id === session.id; });
          return resolve(me && (me.following || []).includes(targetId));
        }
        db.collection('users').doc(session.id).get().then(function(doc) {
          var data = doc.exists ? doc.data() : {};
          resolve((data.following || []).includes(targetId));
        }).catch(function() { resolve(false); });
      });
    });
  },


  getAllReviews: function() {
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var all = [];
          users.forEach(function(u) {
            (u.reviews || []).forEach(function(r) {
              all.push(Object.assign({}, r, { authorPseudo: u.pseudo, authorAvatar: u.avatar, authorId: u.id }));
            });
          });
          all.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
          return resolve(all);
        }
        db.collection('users').get().then(function(snap) {
          var all = [];
          snap.forEach(function(doc) {
            var u = doc.data();
            (u.reviews || []).forEach(function(r) {
              all.push(Object.assign({}, r, { authorPseudo: u.pseudo, authorAvatar: u.avatar, authorId: u.id }));
            });
          });
          all.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
          resolve(all);
        }).catch(function(){ resolve([]); });
      });
    });
  },

  /* AJOUTER UNE RÉPONSE */
  addReply: function(authorId, reviewId, text) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (!text || !text.trim()) return Promise.resolve({ ok: false, error: 'La réponse est vide.' });

    var reply = {
      id: Date.now().toString(),
      authorId: session.id,
      authorPseudo: session.pseudo,
      authorAvatar: session.avatar,
      text: text.trim(),
      date: new Date().toISOString()
    };

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === authorId; });
          if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var review = (user.reviews||[]).find(function(r){ return r.id === reviewId; });
          if (!review) return resolve({ ok: false, error: 'Avis introuvable.' });
          if (!review.replies) review.replies = [];
          review.replies.push(reply);
          self._localSaveUsers(users);
          return resolve({ ok: true, reply: reply });
        }
        var ref = db.collection('users').doc(authorId);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = doc.data().reviews || [];
          var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
          if (idx === -1) return resolve({ ok: false, error: 'Avis introuvable.' });
          if (!reviews[idx].replies) reviews[idx].replies = [];
          reviews[idx].replies.push(reply);
          return ref.update({ reviews: reviews });
        }).then(function() {
          resolve({ ok: true, reply: reply });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau.' });
        });
      });
    });
  },

  /* SUPPRIMER UNE RÉPONSE */
  deleteReply: function(authorId, reviewId, replyId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === authorId; });
          if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var review = (user.reviews||[]).find(function(r){ return r.id === reviewId; });
          if (!review || !review.replies) return resolve({ ok: false, error: 'Réponse introuvable.' });
          review.replies = review.replies.filter(function(rp){ return rp.id !== replyId; });
          self._localSaveUsers(users);
          return resolve({ ok: true });
        }
        var ref = db.collection('users').doc(authorId);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = doc.data().reviews || [];
          var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
          if (idx === -1) return resolve({ ok: false, error: 'Avis introuvable.' });
          reviews[idx].replies = (reviews[idx].replies||[]).filter(function(rp){ return rp.id !== replyId; });
          return ref.update({ reviews: reviews });
        }).then(function() {
          resolve({ ok: true });
        }).catch(function() {
          resolve({ ok: false, error: 'Erreur réseau.' });
        });
      });
    });
  },

  /* TOUS LES UTILISATEURS */
  getUsers: function() {
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) return resolve(self._localGetUsers());
        db.collection('users').get().then(function(snap) {
          resolve(snap.docs.map(function(d){ return d.data(); }));
        }).catch(function(){ resolve([]); });
      });
    });
  },

  /* ── ADMIN ── */

  ADMIN_EMAIL: 'e.ernest.oiry@gmail.com',

  isAdmin: function() {
    var session = this.getSession();
    if (!session) return Promise.resolve(false);
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === session.id; });
          resolve(user && user.email && user.email.toLowerCase() === self.ADMIN_EMAIL);
        } else {
          db.collection('users').doc(session.id).get().then(function(doc) {
            resolve(doc.exists && doc.data().email && doc.data().email.toLowerCase() === self.ADMIN_EMAIL);
          }).catch(function(){ resolve(false); });
        }
      });
    });
  },

  /* Supprimer une review en tant qu'admin (peut supprimer n'importe qui) */
  adminDeleteReview: function(authorId, reviewId) {
    var self = this;
    return new Promise(function(resolve) {
      self.isAdmin().then(function(ok) {
        if (!ok) return resolve({ ok: false, error: 'Accès refusé.' });
        waitForFirebase(function(ready) {
          if (!ready) {
            var users = self._localGetUsers();
            var user = users.find(function(u){ return u.id === authorId; });
            if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
            user.reviews = (user.reviews || []).filter(function(r){ return r.id !== reviewId; });
            self._localSaveUsers(users);
            return resolve({ ok: true });
          }
          var ref = db.collection('users').doc(authorId);
          ref.get().then(function(doc) {
            if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
            var reviews = (doc.data().reviews || []).filter(function(r){ return r.id !== reviewId; });
            return ref.update({ reviews: reviews });
          }).then(function() {
            resolve({ ok: true });
          }).catch(function() {
            resolve({ ok: false, error: 'Erreur réseau.' });
          });
        });
      });
    });
  },

  /* Récupérer le menu de la semaine */
  getMenu: function() {
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var menu = JSON.parse(localStorage.getItem('lb_menu') || 'null');
          return resolve(menu || {});
        }
        db.collection('config').doc('menu').get().then(function(doc) {
          resolve(doc.exists ? doc.data() : {});
        }).catch(function(){ resolve({}); });
      });
    });
  },

  /* Sauvegarder le menu (admin seulement) */
  saveMenu: function(menuData) {
    var self = this;
    return new Promise(function(resolve) {
      self.isAdmin().then(function(ok) {
        if (!ok) return resolve({ ok: false, error: 'Accès refusé.' });
        waitForFirebase(function(ready) {
          if (!ready) {
            localStorage.setItem('lb_menu', JSON.stringify(menuData));
            return resolve({ ok: true });
          }
          db.collection('config').doc('menu').set(menuData).then(function() {
            resolve({ ok: true });
          }).catch(function() {
            resolve({ ok: false, error: 'Erreur réseau.' });
          });
        });
      });
    });
  },

  /* Bannir / débannir un utilisateur */
  adminToggleBan: function(userId) {
    var self = this;
    return new Promise(function(resolve) {
      self.isAdmin().then(function(ok) {
        if (!ok) return resolve({ ok: false, error: 'Accès refusé.' });
        waitForFirebase(function(ready) {
          if (!ready) {
            var users = self._localGetUsers();
            var user = users.find(function(u){ return u.id === userId; });
            if (!user) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
            user.banned = !user.banned;
            self._localSaveUsers(users);
            return resolve({ ok: true, banned: user.banned });
          }
          var ref = db.collection('users').doc(userId);
          ref.get().then(function(doc) {
            if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
            var banned = !doc.data().banned;
            return ref.update({ banned: banned }).then(function() {
              resolve({ ok: true, banned: banned });
            });
          }).catch(function() {
            resolve({ ok: false, error: 'Erreur réseau.' });
          });
        });
      });
    });
  },

  /* NAV */
  updateNav: function() {
    var session = this.getSession();
    var actionsEl = document.querySelector('.nav-actions');
    if (!actionsEl) return;
    var self = this;
    if (session) {
      var adminLink = '';
      self.isAdmin().then(function(isAdm) {
        if (isAdm) {
          adminLink = '<a class="btn-admin-nav" href="admin.html" title="Panneau admin">⚙ Admin</a>';
        }
        actionsEl.innerHTML =
          adminLink +
          '<a href="profil.html" class="nav-profil-btn">' +
            '<span class="nav-avatar">' + session.avatar + '</span>' +
            '<span class="nav-pseudo">' + session.pseudo + '</span>' +
          '</a>' +
          '<button class="btn-ghost" onclick="Auth.logout(); window.location.reload();">Déconnexion</button>';
      });
    } else {
      actionsEl.innerHTML =
        '<a class="btn-ghost" href="connexion.html">Connexion</a>' +
        '<a class="btn-primary" href="inscription.html">Créer un compte</a>';
    }
  },

  /* MOTS INTERDITS */
  getBannedWords: function() {
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          return resolve(JSON.parse(localStorage.getItem('lb_banned_words') || '[]'));
        }
        db.collection('config').doc('banned_words').get().then(function(doc) {
          resolve(doc.exists ? (doc.data().words || []) : []);
        }).catch(function() {
          resolve(JSON.parse(localStorage.getItem('lb_banned_words') || '[]'));
        });
      });
    });
  },

  adminSetBannedWords: function(words) {
    var self = this;
    return new Promise(function(resolve) {
      self.isAdmin().then(function(ok) {
        if (!ok) return resolve({ ok: false, error: 'Accès refusé.' });
        waitForFirebase(function(ready) {
          if (!ready) {
            localStorage.setItem('lb_banned_words', JSON.stringify(words));
            return resolve({ ok: true });
          }
          db.collection('config').doc('banned_words').set({ words: words }).then(function() {
            resolve({ ok: true });
          }).catch(function() {
            resolve({ ok: false, error: 'Erreur réseau.' });
          });
        });
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

  /* HELPERS PRIVÉS */
  _localGetUsers: function() { return JSON.parse(localStorage.getItem('lb_users') || '[]'); },
  _localSaveUsers: function(users) { localStorage.setItem('lb_users', JSON.stringify(users)); },
  _createUserObj: function(pseudo, email, password) {
    var AVATARS = ['🧔','🧑‍💻','👩‍🎓','👨‍🍳','🧒','👩','👦','👧','🙋','🧑'];
    return {
      id: Date.now().toString(), pseudo: pseudo, email: email, password: password,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      joinedAt: new Date().toISOString(), reviews: [],
      pseudoLower: pseudo.toLowerCase(), emailLower: email.toLowerCase()
    };
  }
};

/* ── Styles nav ── */
(function() {
  var style = document.createElement('style');
  style.textContent = '.nav-profil-btn{display:flex;align-items:center;gap:.5rem;background:var(--surface2,#1e1f1a);border:1px solid var(--border,#2a2b25);padding:.35rem .9rem .35rem .5rem;border-radius:3px;text-decoration:none;transition:border-color .2s}.nav-profil-btn:hover{border-color:var(--accent,#c8f542)}.nav-avatar{font-size:1.1rem}.nav-pseudo{font-size:.82rem;font-weight:500;color:var(--text,#e8e6dc);font-family:"DM Sans",sans-serif}.btn-admin-nav{display:inline-flex;align-items:center;gap:.35rem;background:rgba(232,69,69,0.12);border:1px solid rgba(232,69,69,0.35);color:#e84545;padding:.35rem .9rem;border-radius:3px;text-decoration:none;font-size:.82rem;font-weight:600;font-family:"DM Sans",sans-serif;transition:all .2s}.btn-admin-nav:hover{background:rgba(232,69,69,0.22);border-color:#e84545}';
  document.head.appendChild(style);
})();

document.addEventListener('DOMContentLoaded', function(){ Auth.updateNav(); });
