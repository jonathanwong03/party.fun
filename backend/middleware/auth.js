import jwt from 'jsonwebtoken';
 

export const isUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; 
 
  if (!token) {
    return res.status(401).json({ error: 'Not logged in' });
  }
 
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
 

// same logic, just jwt instead of session
export const isAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
 
  if (!token) {
    return res.status(401).json({ error: 'Not logged in' });
  }
 
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admins only' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};