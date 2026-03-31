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
      date: new Date().toISOString(),
      likes: [],
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
              all.push(Object.assign({}, r, { authorPseudo: u.pseudo, authorAvatar: u.avatar, authorId: u.id, authorData: u }));
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
              all.push(Object.assign({}, r, { authorPseudo: u.pseudo, authorAvatar: u.avatar, authorId: u.id, authorData: u }));
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

  /* ── LIKES ── */

  likeReview: function(authorId, reviewId) {
    var self = this;
    var session = this.getSession();
    if (!session) return Promise.resolve({ ok: false, error: 'Non connecté.' });
    if (session.id === authorId) return Promise.resolve({ ok: false, error: 'Tu ne peux pas liker ta propre critique.' });

    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var author = users.find(function(u){ return u.id === authorId; });
          if (!author) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var review = (author.reviews || []).find(function(r){ return r.id === reviewId; });
          if (!review) return resolve({ ok: false, error: 'Critique introuvable.' });
          if (!review.likes) review.likes = [];
          var idx = review.likes.indexOf(session.id);
          var liked;
          if (idx === -1) { review.likes.push(session.id); liked = true; }
          else { review.likes.splice(idx, 1); liked = false; }
          self._localSaveUsers(users);
          self.checkAndGrantBadges(authorId);
          return resolve({ ok: true, liked: liked, count: review.likes.length });
        }
        var ref = db.collection('users').doc(authorId);
        ref.get().then(function(doc) {
          if (!doc.exists) return resolve({ ok: false, error: 'Utilisateur introuvable.' });
          var reviews = doc.data().reviews || [];
          var idx = reviews.findIndex(function(r){ return r.id === reviewId; });
          if (idx === -1) return resolve({ ok: false, error: 'Critique introuvable.' });
          if (!reviews[idx].likes) reviews[idx].likes = [];
          var likeIdx = reviews[idx].likes.indexOf(session.id);
          var liked;
          if (likeIdx === -1) { reviews[idx].likes.push(session.id); liked = true; }
          else { reviews[idx].likes.splice(likeIdx, 1); liked = false; }
          var count = reviews[idx].likes.length;
          return ref.update({ reviews: reviews }).then(function() {
            self.checkAndGrantBadges(authorId);
            resolve({ ok: true, liked: liked, count: count });
          });
        }).catch(function() { resolve({ ok: false, error: 'Erreur réseau.' }); });
      });
    });
  },

  /* ── BADGES ── */

  BADGES: [
    // critiques — catégorie 'reviews', du plus faible au plus fort
    { id: 'first_review',   emoji: '✍️',  label: 'Première critique',  desc: 'A écrit sa 1ère critique',    cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 1; } },
    { id: 'review_5',       emoji: '📝',  label: 'Critique x5',        desc: 'A écrit 5 critiques',          cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 5; } },
    { id: 'review_10',      emoji: '🗒️', label: 'Critique x10',       desc: 'A écrit 10 critiques',         cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 10; } },
    { id: 'review_25',      emoji: '📖',  label: 'Gourmet',            desc: 'A écrit 25 critiques',         cat: 'reviews',    condition: function(u){ return (u.reviews||[]).length >= 25; } },
    // likes — catégorie 'likes'
    { id: 'likes_10',       emoji: '❤️',  label: 'Populaire',          desc: 'A reçu 10 likes au total',     cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 10; } },
    { id: 'likes_50',       emoji: '🔥',  label: 'En feu',             desc: 'A reçu 50 likes au total',     cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 50; } },
    { id: 'likes_100',      emoji: '⭐',  label: 'Star',               desc: 'A reçu 100 likes au total',    cat: 'likes',      condition: function(u){ return Auth._totalLikes(u) >= 100; } },
    // abonnés — catégorie 'followers'
    { id: 'first_follower', emoji: '👥',  label: 'Premier fan',        desc: 'A obtenu son 1er abonné',      cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 1; } },
    { id: 'followers_10',   emoji: '🌟',  label: 'Influenceur',        desc: 'A obtenu 10 abonnés',          cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 10; } },
    { id: 'followers_50',   emoji: '👑',  label: 'Star du campus',     desc: 'A obtenu 50 abonnés',          cat: 'followers',  condition: function(u){ return (u.followers||[]).length >= 50; } },
    // ancienneté — catégorie 'seniority'
    { id: 'member_1m',      emoji: '🌱',  label: 'Membre 1 mois',      desc: 'Inscrit depuis 1 mois',        cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 1; } },
    { id: 'member_6m',      emoji: '🌿',  label: 'Membre 6 mois',      desc: 'Inscrit depuis 6 mois',        cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 6; } },
    { id: 'member_1y',      emoji: '🏆',  label: 'Vétéran',            desc: 'Inscrit depuis 1 an',          cat: 'seniority',  condition: function(u){ return Auth._memberMonths(u) >= 12; } },
    // admin — catégorie unique
    { id: 'admin',          emoji: '👸',  label: 'Administrateur',     desc: 'Administrateur du site',       cat: 'admin',      condition: function(u){ return u.email && u.email.toLowerCase() === Auth.ADMIN_EMAIL; } },
  ],

  // Retourne uniquement le badge le plus élevé par catégorie
  getBestBadges: function(userData) {
    var self = this;
    var byCategory = {};
    this.BADGES.forEach(function(b) {
      if (b.condition(userData)) {
        byCategory[b.cat] = b; // écrase le précédent = garde le plus fort (ordre du tableau)
      }
    });
    return Object.values(byCategory);
  },

  _totalLikes: function(u) {
    return (u.reviews || []).reduce(function(sum, r){ return sum + (r.likes ? r.likes.length : 0); }, 0);
  },

  _memberMonths: function(u) {
    if (!u.joinedAt) return 0;
    var diff = Date.now() - new Date(u.joinedAt).getTime();
    return diff / (1000 * 60 * 60 * 24 * 30);
  },

  getBadges: function(userData) {
    return this.BADGES.filter(function(b){ return b.condition(userData); });
  },

  checkAndGrantBadges: function(userId) {
    var self = this;
    return new Promise(function(resolve) {
      waitForFirebase(function(ready) {
        if (!ready) {
          var users = self._localGetUsers();
          var user = users.find(function(u){ return u.id === userId; });
          if (!user) return resolve();
          var earned = self.getBadges(user).map(function(b){ return b.id; });
          user.badges = earned;
          self._localSaveUsers(users);
          return resolve(earned);
        }
        db.collection('users').doc(userId).get().then(function(doc) {
          if (!doc.exists) return resolve();
          var userData = doc.data();
          var earned = self.getBadges(userData).map(function(b){ return b.id; });
          return db.collection('users').doc(userId).update({ badges: earned }).then(function(){ resolve(earned); });
        }).catch(function(){ resolve(); });
      });
    });
  },

  renderBadges: function(userData, options) {
    options = options || {};
    // Par défaut on affiche seulement le meilleur badge par catégorie
    var badges = options.all ? this.getBadges(userData) : this.getBestBadges(userData);
    if (!badges.length) return options.empty || '';
    var size = options.size || 'normal';
    var max = options.max || 999;
    var shown = badges.slice(0, max);
    var wrapStyle = size === 'small'
      ? 'display:inline-flex;gap:3px;align-items:center;flex-wrap:wrap;'
      : 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;';
    var badgeStyle = size === 'small'
      ? 'font-size:0.85rem;cursor:default;'
      : 'font-size:1.1rem;cursor:default;background:rgba(200,245,66,0.08);border:1px solid rgba(200,245,66,0.2);border-radius:6px;padding:3px 8px;';
    return '<span style="' + wrapStyle + '">' +
      shown.map(function(b){
        return '<span title="' + b.label + ' — ' + b.desc + '" style="' + badgeStyle + '">' + b.emoji + '</span>';
      }).join('') +
      (badges.length > max ? '<span style="font-size:0.75rem;color:#888;margin-left:2px;">+' + (badges.length - max) + '</span>' : '') +
    '</span>';
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
    background: var(--surface,#16181200); backdrop-filter: blur(12px);
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
    // Inject into every nav that has nav-links
    var navEls = document.querySelectorAll('nav');
    navEls.forEach(function(nav) {
      if (nav.querySelector('.nav-search-wrap')) return; // already injected
      var links = nav.querySelector('.nav-links');
      if (!links) return;

      var wrap = document.createElement('div');
      wrap.className = 'nav-search-wrap';
      wrap.innerHTML =
        '<span class="nav-search-icon">🔍</span>' +
        '<input class="nav-search-input" id="navSearchInput" type="text" placeholder="Rechercher…" autocomplete="off">' +
        '<div class="nav-search-dropdown" id="navSearchDropdown"></div>';

      // Insert after nav-links
      links.insertAdjacentElement('afterend', wrap);

      var input = wrap.querySelector('#navSearchInput');
      var dropdown = wrap.querySelector('#navSearchDropdown');
      var searchTimer = null;

      input.addEventListener('input', function() {
        clearTimeout(searchTimer);
        var q = input.value.trim();
        if (!q) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
        searchTimer = setTimeout(function(){ doSearch(q, dropdown); }, 200);
      });

      input.addEventListener('focus', function() {
        if (input.value.trim()) dropdown.classList.add('open');
      });

      document.addEventListener('click', function(e) {
        if (!wrap.contains(e.target)) {
          dropdown.classList.remove('open');
        }
      });
    });
  }

  async function doSearch(q, dropdown) {
    dropdown.classList.add('open');
    dropdown.innerHTML = '<div class="search-empty">Recherche…</div>';

    var lower = q.toLowerCase();

    try {
      var users = await Auth.getUsers();
      var allReviews = await Auth.getAllReviews();

      // Filter users
      var matchedUsers = users.filter(function(u) {
        return u.pseudo && u.pseudo.toLowerCase().includes(lower);
      }).slice(0, 5);

      // Filter meals (unique meal names from reviews)
      var mealMap = {};
      allReviews.forEach(function(r) {
        var name = r.mealName || '';
        if (name.toLowerCase().includes(lower)) {
          if (!mealMap[name]) mealMap[name] = { name: name, count: 0, authorId: r.authorId, reviewId: r.id };
          mealMap[name].count++;
        }
      });
      var matchedMeals = Object.values(mealMap).sort(function(a,b){ return b.count - a.count; }).slice(0, 5);

      if (!matchedUsers.length && !matchedMeals.length) {
        dropdown.innerHTML = '<div class="search-empty">Aucun résultat pour «&nbsp;' + q + '&nbsp;»</div>';
        return;
      }

      var html = '';

      if (matchedUsers.length) {
        html += '<div class="search-section-label">👤 Utilisateurs</div>';
        matchedUsers.forEach(function(u) {
          var badges = Auth.renderBadges(u, {size:'small', max:2});
          html += '<a class="search-result-item" href="profil-public.html?id=' + u.id + '">' +
            '<span class="search-result-avatar">' + (u.avatar || '🧑') + '</span>' +
            '<span>' +
              '<div class="search-result-name">' + u.pseudo + ' ' + badges + '</div>' +
              '<div class="search-result-sub">@' + u.pseudo.toLowerCase().replace(/\s+/g,'_') + ' · ' + (u.reviews||[]).length + ' avis</div>' +
            '</span>' +
          '</a>';
        });
      }

      if (matchedMeals.length) {
        html += '<div class="search-section-label">🍽️ Plats</div>';
        matchedMeals.forEach(function(m) {
          html += '<a class="search-result-item" href="critiques.html">' +
            '<span class="search-result-avatar">🍴</span>' +
            '<span>' +
              '<div class="search-result-name">' + m.name + '</div>' +
              '<div class="search-result-sub">' + m.count + ' critique' + (m.count > 1 ? 's' : '') + '</div>' +
            '</span>' +
          '</a>';
        });
      }

      dropdown.innerHTML = html;
    } catch(e) {
      dropdown.innerHTML = '<div class="search-empty">Erreur de recherche.</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    injectSearchBar();
    // Re-inject after nav update (since updateNav is async)
    setTimeout(injectSearchBar, 800);
  });
})();


/* ── POP-UP WANTED ── */
(function() {
  var PAGE_THRESHOLD = 3;
  var STORAGE_KEY = 'lb_page_count';

  function getCount() {
    return parseInt(sessionStorage.getItem(STORAGE_KEY) || '0', 10);
  }
  function incrementCount() {
    var c = getCount() + 1;
    sessionStorage.setItem(STORAGE_KEY, c);
    return c;
  }

  function showWantedPopup() {
    if (document.getElementById('wantedOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';

    overlay.innerHTML = `
      <div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:380px;width:90%;max-height:90vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 0 60px rgba(200,245,66,0.15);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);">
        <!-- Header -->
        <div style="background:#c8f542;padding:12px 20px;text-align:center;">
          <div style="font-family:'DM Mono',monospace;font-size:0.65rem;letter-spacing:0.2em;color:#000;font-weight:700;">⚠️ AVIS DE RECHERCHE ⚠️</div>
          <div style="font-family:'Playfair Display',serif;font-size:1.6rem;font-weight:900;color:#000;letter-spacing:0.1em;">WANTED</div>
        </div>
        <!-- Photo -->
        <div style="position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0d0e0b;">
          <img src="wanted.jpg" alt="Suspect" style="width:100%;display:block;filter:sepia(30%) contrast(1.1);">
          <div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(transparent,#1a1c17);"></div>
        </div>
        <!-- Body -->
        <div style="padding:16px 20px 20px;text-align:center;">
          <div style="font-family:'DM Mono',monospace;font-size:0.7rem;color:#c8f542;letter-spacing:0.1em;margin-bottom:8px;">INDIVIDU DANGEREUX</div>
          <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#e8e6dc;line-height:1.5;margin-bottom:6px;">
            Cet individu est activement recherché pour le <strong style="color:#c8f542;">vol de yaourts</strong> à la cantine.
          </div>
          <div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">
            Si vous le reconnaissez, signalez-le immédiatement à la direction.
          </div>
          <div style="font-size:0.7rem;color:#555;margin-bottom:14px;">Récompense : 1 yaourt à la fraise 🍓</div>
          <button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');"
            style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;transition:all 0.2s;width:100%;"
            onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">
            ✅ Message reçu, je reste vigilant
          </button>
        </div>
      </div>
    `;

    // Add keyframe animations
    if (!document.getElementById('wantedStyles')) {
      var s = document.createElement('style');
      s.id = 'wantedStyles';
      s.textContent = '@keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}@keyframes popIn{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}';
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        overlay.remove();
        sessionStorage.setItem('lb_page_count', '0');
      }
    });
  }

  function showPommesSmilePopup() {
    if (document.getElementById('wantedOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';

    overlay.innerHTML = `
      <div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:360px;width:90%;max-height:90vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 0 60px rgba(200,245,66,0.2);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);text-align:center;">
        <div style="background:#c8f542;padding:14px 20px;">
          <div style="font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:900;color:#000;">🍎 POMMES SMILE</div>
          <div style="font-family:'DM Mono',monospace;font-size:0.65rem;color:#000;letter-spacing:0.1em;font-weight:700;">À LA CANTINE AUJOURD'HUI !</div>
        </div>
        <div style="overflow:hidden;display:flex;align-items:center;justify-content:center;background:#0d0e0b;">
          <img src="pommes-smile.png" alt="Pommes smile !" style="width:100%;display:block;">
        </div>
        <div style="padding:16px 20px 20px;">
          <div style="font-family:'Playfair Display',serif;font-size:1rem;color:#e8e6dc;margin-bottom:6px;">C'est <strong style="color:#c8f542;">pommes smile</strong> ce midi !!! 🎉</div>
          <div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">La meilleure nouvelle de la journée.</div>
          <button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');"
            style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;width:100%;"
            onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">
            🍎 TROP BIEN !!!
          </button>
        </div>
      </div>
    `;

    if (!document.getElementById('wantedStyles')) {
      var s = document.createElement('style');
      s.id = 'wantedStyles';
      s.textContent = '@keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}@keyframes popIn{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}';
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.remove(); sessionStorage.setItem('lb_page_count', '0'); }
    });
  }

  function showKfcPopup() {
    if (document.getElementById('wantedOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'wantedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInOverlay 0.3s ease;';

    overlay.innerHTML = `
      <div style="background:#1a1c17;border:2px solid #c8f542;border-radius:16px;padding:0;max-width:420px;width:90%;overflow:hidden;box-shadow:0 0 60px rgba(200,245,66,0.15);animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);text-align:center;">
        <div style="background:#c8f542;padding:14px 20px;">
          <div style="font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:900;color:#000;">🤔 LA QUESTION DU JOUR</div>
        </div>
        <div style="overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;">
          <img src="kfc7.gif" alt="Why was 6 afraid of 7?" style="width:100%;object-fit:contain;">
        </div>
        <div style="padding:16px 20px 20px;">
          <div style="font-size:0.78rem;color:#888;font-family:'DM Mono',monospace;margin-bottom:16px;">Because 7 eight 9 🍗</div>
          <button onclick="document.getElementById('wantedOverlay').remove();sessionStorage.setItem('lb_page_count','0');"
            style="background:#c8f542;color:#000;border:none;border-radius:8px;padding:10px 28px;font-weight:700;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;width:100%;"
            onmouseover="this.style.background='#d4f55a'" onmouseout="this.style.background='#c8f542'">
            😂 J'ai compris, laisse moi tranquille
          </button>
        </div>
      </div>
    `;

    if (!document.getElementById('wantedStyles')) {
      var s = document.createElement('style');
      s.id = 'wantedStyles';
      s.textContent = '@keyframes fadeInOverlay{from{opacity:0}to{opacity:1}}@keyframes popIn{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}';
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.remove(); sessionStorage.setItem('lb_page_count', '0'); }
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    var count = incrementCount();
    if (count >= PAGE_THRESHOLD) {
      var popups = [showWantedPopup, showPommesSmilePopup, showKfcPopup];
      var chosen = popups[Math.floor(Math.random() * popups.length)];
      setTimeout(chosen, 600);
      sessionStorage.setItem('lb_page_count', '0');
    }
  });
})();

document.addEventListener('DOMContentLoaded', function(){ Auth.updateNav(); });
