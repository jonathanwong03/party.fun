exports.isUser = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  req.user = req.session.user;
  next();
}; //this user part is OPTIONAL idk whether to put so i put first can dleete cos we havent decide yet need log in or not...

exports.isAdmin = (req, res, next) => { 
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).send("Admins only");
  }

  req.user = req.session.user;
  next();
};

