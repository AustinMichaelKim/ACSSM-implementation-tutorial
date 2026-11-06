import torch

def make_ou_data(
        n_series : int = 128, 
        n_times : int = 40, 
        dim : int = 3, 
        *,
        a : torch.Tensor | None = None ,   # mean-reversion coefficient ( how strong it would reverts to the origin. )
        mu : torch.Tensor | None = None ,
        sigma : torch.Tensor | None = None,
        obs_std : float = 0.1, 
        seed: int =42 
        ) -> dict:


        # create tensors for K, mu, G 
        if a is None:
                a = torch.ones(dim)
        if mu is None:
                mu = torch.zeros(dim)
        if sigma is None:
                sigma = torch.ones(dim)

        assert isinstance(a, torch.Tensor) and a.shape == (dim,)
        assert isinstance(mu,torch.Tensor) and mu.shape == a.shape
        assert isinstance(sigma, torch.Tensor) and sigma.shape == a.shape


        # make irregular time stamp ( seen 70% + unseen 30% )

        g = torch.Generator().manual_seed(seed)



        dt = 0.05 + 0.15*torch.rand(n_series , n_times-1 , generator= g ) # 0.05 < dt < 0.20 uniform sampling

        times = torch.cat( [torch.zeros(n_series,1) , torch.cumsum(dt, dim=1) ], dim = 1)


        # from given distribution of d-dim OU process, make observation sampling

        x = torch.zeros(n_series, n_times, dim)

        a_expand = a.unsqueeze(0).expand(n_series,-1)
        sigma_expand = sigma.unsqueeze(0).expand(n_series,-1)
        mu_expand = mu.unsqueeze(0).expand(n_series,-1)


        x[:,0,:] = mu_expand + torch.sqrt( sigma_expand**2 / 2*a_expand ) * torch.randn(n_series,dim, generator=g)


        for t_i in range(n_times-1):

                variance = (sigma_expand**2 / (2*a_expand) )* (-1) * (torch.expm1(-2*a_expand*dt[:,t_i:t_i+1]))
                decay = torch.exp(-a_expand * dt[:,t_i:t_i+1])

                x[:, t_i + 1,:] = mu_expand + decay * (x[:, t_i, :] - mu_expand) + torch.sqrt(variance) * torch.randn(n_series,dim, generator = g)



        # observation model ( obs = x + obs_std * rand )
        """
        latent_truth :  given SDE, the truth latex vector X_t

        target :  truth X_t + noisy observation factor =  observation o_t in paper.

        latent_truth : shallow copy ( reference )
        target : deep copy ( new tensor )
        """
        latent_truth = x  
        target = x + obs_std * torch.randn(n_series, n_times, dim, generator=g)


        assert target.shape == (n_series,n_times,dim)




        # masking 30% of unseen data
        """
        tensor > 1  =>  making boolean tensor ( boolean masking ) consisting True element where the element is larger than 1

        tensor[:, :2, : ]  => (128, 2, 3) type of tensor starting from initial to (2-1 = 1)
        """
        obs_mask = torch.rand(n_series, n_times , generator=g) > 0.3
        target_mask = torch.zeros(n_series, n_times) == 0

        obs_mask[:, :2] = True

        """
        at first, use unsqueeze to make extra dim ( 128, 40 ) -> (128, 40, 1)
        ( -1 : add another dim at the last position )

        then repeat ( expand ) using this tensor  (128, 40, 1) -> (128, 40, 3)

        expand (-1,-1, 3) : maintain the dim of the row and col. and expand the dim of last dim.
        """
        obs = torch.where(
                obs_mask.unsqueeze(-1),
                target,
                torch.zeros_like(target)
        )


        dataset = {
                "times" : times,
                "observation" : obs,
                "obs_mask" : obs_mask,
                "target" : target,
                "target_mask" : target_mask,
                "latent_truth" : latent_truth

        }

        return dataset