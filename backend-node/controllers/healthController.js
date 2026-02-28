export const healthCheck = (req, res) => {
  res.status(200).json({ status: "ok", service: "backend-node" });
};
