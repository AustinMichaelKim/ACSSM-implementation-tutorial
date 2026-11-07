import torch
from torch import nn


"""
    Implement encoder class containing Sampling, Attention mechanism.

    define class that inherits "nn.Moduel" which contains ML moudles
"""
class ObsEncoder(nn.Module):

    """
        Initializaing the instance of this class 

        encoder = ObsEncoder( obs_dim = 1, embed_dim = 8)

        therefore, embedding the observed data to higher dimensional latent representation.
    """
    def __init__(self, obs_dim: int , embed_dim: int):

        # initializing the modules under nn.Module so that this class use them.
        super().__init__()

        """
            define net object.

            net is multi layer perceptron.
        """
        self.encoder_mean_mlp = nn.Sequential(
            nn.Linear(2 * obs_dim, embed_dim),
            nn.ReLU(),
            nn.Linear(embed_dim, embed_dim),
        )


    def forward(self, obs : torch.Tensor, obs_mask: torch.Tensor):

        """
            obs_mask.shape = (B,T), 
            therefore, (B,T) -> (B,T,1) -> (B,T,obs_dim)

            (B,T,1).expand_as(obs) = (B,T,obs_dim)

            features = obs + mask  = (B,T, dim + dim )
        """
        mask = obs_mask.unsqueeze(-1)
        mask_values = mask.to(obs.dtype).expand_as(obs)
        features = torch.cat([obs, mask_values] , dim=-1)

        
        """
            Input : (B,T,2*dim)
            Output : (B,T, embed_dim )

            Calculate the mean of encoder dist, using forward pass through MLP.
        """
        encoder_mean = self.encoder_mean_mlp(features)

        # Fixed cov. ( Sigma_q = sigma_q^2 * I)
        sigma_q = 0.1

        """
            Reparametrization.

            
            when autograd is used, we need to differentiate the objective with phi.
            To do this, use  "rsample method" to deliver the gradient.

            
            dist :  the probability dist object.
            .rsample() : sampling the y value from this dist, moreover, this sampling can deliver
            the gradinet.

            
            for example, if a loss function contains 'y', and tries to get dy/d(mu_phi), 
            rsample enables this propagation.

            rsample == reparametrization + sampling.
        """
        dist = torch.distributions.Normal(encoder_mean, sigma_q)
        y = dist.rsample()


        # Conceal the unseen data vector using mask.
        y = torch.where(
            mask,
            y,
            torch.zeros_like(y)
        )

        return y
